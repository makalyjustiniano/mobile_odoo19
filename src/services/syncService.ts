import { callOdoo, fetchPortalMetadata } from '../api/odooClient';
import { useAuthStore } from '../store/authStore';
import { useConfigStore } from '../store/configStore';
import { getSiatDomain } from '../utils/permissionUtils';
import * as db from './dbService';
import * as FileSystem from 'expo-file-system/legacy';

export const submitPickingDelivery = async (
    pickingId: number,
    deliveries: Array<{ moveId: number; quantity: number }>,
    silent: boolean = false
) => {
    for (const delivery of deliveries) {
        await callOdoo('stock.move', 'write', {
            ids: [delivery.moveId],
            vals: {
                quantity: delivery.quantity
            }
        }, silent);
    }

    await callOdoo('stock.picking', 'button_validate', {
        ids: [pickingId],
        context: {
            skip_backorder: true
        }
    }, silent);
};

export const syncPortalMetadata = async (onProgress?: (msg: string) => void) => {
    const { user, updateUser } = useAuthStore.getState();
    const { getActiveProfile } = useConfigStore.getState();
    const activeProfile = getActiveProfile();

    const uid = user?.uid;
    const apiKey = user?.apiKey || activeProfile?.apiKey;
    const database = user?.database || activeProfile?.database;
    const url = user?.url || activeProfile?.url;

    if (!uid || !url || !database) {
        console.warn('[SYNC] No hay datos suficientes para refrescar metadatos.');
        return null;
    }

    onProgress?.('Verificando privilegios...');
    try {
        const portalInfo = await fetchPortalMetadata(uid, {
            url,
            database,
            apiKey: apiKey || '',
            sessionId: (user as any)?.sessionId || ''
        });
        
        if (portalInfo && portalInfo.permissions) {
            const updatedApiKey = portalInfo.apiKey || portalInfo.siatApiKey || apiKey;
            const companyIds = portalInfo.companyIds || user?.company_ids || [user?.company_id || 1];

            updateUser({ 
                permissions: portalInfo.permissions, 
                company_id: portalInfo.companyId || (user as any).company_id,
                company_ids: companyIds,
                apiKey: updatedApiKey
            });
            console.log('[SYNC] Privilegios actualizados con éxito.');
            return portalInfo;
        }
    } catch (e) {
        console.warn('[SYNC] No se pudieron refrescar los privilegios:', (e as any).message);
    }
    return null;
};

export const runSync = async (onProgress?: (msg: string) => void) => {
    const { user } = useAuthStore.getState();
    const uid = user?.uid;

    if (!uid) {
        throw new Error("No hay un usuario identificado.");
    }

    // 0. ACTUALIZACIÓN CRÍTICA DE PERMISOS
    const portalInfo = await syncPortalMetadata(onProgress);
    
    const effectivePermissions = portalInfo?.permissions || user?.permissions || {
        is_admin: false,
        view_sales: false,
        view_invoices: false,
        view_contacts: false,
        view_pickings: false,
        view_receivables: false,
        role_codes: []
    };

    const companyIds = portalInfo?.companyIds || user?.company_ids || [user?.company_id || 1];


    try {
        await db.initDB();
        const companyId = user?.company_id || 1;
        
        const baseUser = { 
            uid: Number(uid), 
            company_id: companyId, 
            company_ids: companyIds 
        };

        // Pre-Sync coordenadas de la empresa
        try {
            const companyData: any = await callOdoo('res.company', 'read', {
                ids: [companyId],
                fields: ['partner_id']
            });
            if (companyData?.[0]?.partner_id) {
                const partnerData: any = await callOdoo('res.partner', 'read', {
                    ids: [companyData[0].partner_id[0]],
                    fields: ['partner_latitude', 'partner_longitude']
                });
                if (partnerData?.[0]) {
                    useAuthStore.setState(prev => ({
                        user: prev.user ? {
                            ...prev.user,
                            company_latitude: partnerData[0].partner_latitude,
                            company_longitude: partnerData[0].partner_longitude
                        } : null
                    }));
                }
            }
        } catch (e) {
            console.warn('Could not fetch company coordinates');
        }

        console.log('--- DIAGNÓSTICO DE SINCRONIZACIÓN ---');
        console.log('User UID:', baseUser.uid);
        console.log('Company IDs:', JSON.stringify(baseUser.company_ids));
        console.log('Roles:', JSON.stringify(effectivePermissions.role_codes));
        console.log('-------------------------------------');

        let orders: any[] = [];

        // 1. Sync Partners
        if (effectivePermissions.view_contacts || effectivePermissions.is_admin) {
            onProgress?.('Sincronizando clientes...');
            const partnerDomain = getSiatDomain('res.partner', baseUser, effectivePermissions);
            const partners = await callOdoo('res.partner', 'search_read', {
                domain: partnerDomain,
                fields: [
                    "display_name", "email", "phone", "lang", "vat",
                    "street", "street2", "city", "zip",
                    "credit", "debit", "credit_limit", "total_due", "total_overdue",
                    "comment", "image_128", "company_id", "user_id",
                    "x_studio_complemento", "x_studio_giro", 
                    "x_studio_pago_a_proveedor", "x_studio_pago_de_cliente", 
                    "x_studio_razon_social", "x_studio_tipo_de_documento",
                    "partner_latitude", "partner_longitude"
                ],
                limit: 500
            });
            await db.clearTable('partners');
            if (partners?.length > 0) await db.savePartners(partners);
        }

        // 2. Sync Sale Orders
        if (effectivePermissions.view_sales || effectivePermissions.is_admin) {
            onProgress?.('Sincronizando ventas...');
            const saleDomain = getSiatDomain('sale.order', baseUser, effectivePermissions);
            orders = await callOdoo('sale.order', 'search_read', {
                domain: saleDomain,
                fields: ["name", "display_name", "partner_id", "date_order", "state", "amount_total", "order_line", "invoice_ids", "company_id", "user_id"],
                limit: 100,
                order: "date_order desc"
            });
            await db.clearTable('sale_orders');
            await db.clearTable('sale_order_lines');
            
            if (orders?.length > 0) {
                const allOrderLineIds = orders.flatMap((o: any) => o.order_line || []);
                if (allOrderLineIds.length > 0) {
                    const lines = await callOdoo('sale.order.line', 'search_read', {
                        domain: [['id', 'in', allOrderLineIds]],
                        fields: ["product_id", "product_uom_qty", "price_unit", "price_subtotal"]
                    });
                    orders.forEach((o: any) => {
                        o.lines_data = lines.filter((l: any) => (o.order_line || []).includes(l.id));
                    });
                }
                await db.saveSaleOrders(orders);
            }
        }

        // 3. Sync Account Moves (Invoices)
        // We separate "Global Receivables" from "Linked Invoices" to ensure salespeople get their data.
        const canViewInv = effectivePermissions.view_invoices || effectivePermissions.view_receivables || effectivePermissions.is_admin;
        
        if (canViewInv) {
            onProgress?.('Sincronizando facturas...');
            
            // 3a. Global Receivables (Only for collections/admin)
            let pendingMoves: any[] = [];
            if (effectivePermissions.view_receivables || effectivePermissions.is_admin) {
                console.log('[SYNC] Descargando deudas pendientes...');
                const invoiceDomain = getSiatDomain('account.move', baseUser, effectivePermissions);
                pendingMoves = await callOdoo('account.move', 'search_read', {
                    domain: invoiceDomain,
                    fields: [
                        'name', 'partner_id', 'move_type', 'state', 'payment_state',
                        'invoice_date', 'invoice_date_due', 'amount_total',
                        'amount_residual', 'invoice_line_ids', 'invoice_user_id', 'company_id',
                        'siat_estado', 'siat_qr_string', 'siat_qr_image', 'siat_cuf'
                    ],
                    limit: 200
                });
            }

            // 3b. Linked Invoices (For anyone who can see sales/invoices)
            const saleInvoiceIds = Array.from(new Set(
                (orders || []).flatMap((o: any) => Array.isArray(o.invoice_ids) ? o.invoice_ids : [])
            ));

            let saleMoves: any[] = [];
            if (saleInvoiceIds.length > 0) {
                console.log(`[SYNC] Descargando ${saleInvoiceIds.length} facturas vinculadas a pedidos...`);
                saleMoves = await callOdoo('account.move', 'search_read', {
                    domain: [['id', 'in', saleInvoiceIds]],
                    fields: [
                        'name', 'partner_id', 'move_type', 'state', 'payment_state',
                        'invoice_date', 'invoice_date_due', 'amount_total',
                        'amount_residual', 'invoice_line_ids', 'invoice_user_id', 'company_id',
                        'siat_estado', 'siat_qr_string', 'siat_qr_image', 'siat_cuf'
                    ],
                    limit: saleInvoiceIds.length
                });
            }

            // Merge results
            const invoiceToOrderMap = new Map<number, number>();
            (orders || []).forEach((o: any) => {
                if (Array.isArray(o.invoice_ids)) {
                    o.invoice_ids.forEach((iid: number) => invoiceToOrderMap.set(iid, o.id));
                }
            });

            const moveMap = new Map<number, any>();
            [...pendingMoves, ...saleMoves].forEach((move: any) => {
                if (move?.id) {
                    move.origin_order_id = invoiceToOrderMap.get(move.id) || 0;
                    moveMap.set(move.id, move);
                }
            });

            const moves = Array.from(moveMap.values());
            const moveIds = moves.map((move: any) => move.id).filter(Boolean);

            if (moveIds.length > 0) {
                const moveLines = await callOdoo('account.move.line', 'search_read', {
                    domain: [
                        ['move_id', 'in', moveIds],
                        ['display_type', 'not in', ['line_section', 'line_note']]
                    ],
                    fields: [
                        'move_id', 'product_id', 'quantity', 'price_unit', 'price_subtotal',
                        'debit', 'credit', 'name', 'product_uom_id', 'date_maturity'
                    ],
                    limit: moveIds.length * 20
                });

                const linesByMoveId = new Map<number, any[]>();
                for (const line of moveLines) {
                    const mid = Array.isArray(line.move_id) ? line.move_id[0] : line.move_id;
                    if (!linesByMoveId.has(mid)) linesByMoveId.set(mid, []);
                    linesByMoveId.get(mid)?.push(line);
                }

                for (const move of moves) {
                    move.lines = linesByMoveId.get(move.id) || [];
                }
            }

            // NOTE: We stop clearing the table totally to favor a "Merge/Update" strategy.
            // This ensures paid invoices linked to recent sales are preserved offline.
            // await db.clearTable('account_moves'); // Removed
            // await db.clearTable('account_move_lines'); // Removed
            
            if (moves.length > 0) await db.saveAccountMoves(moves);
        }

        // 4. Sync Stock Moves
        if (effectivePermissions.view_pickings || effectivePermissions.is_admin) {
            onProgress?.('Sincronizando distribución...');
            const basePickingDomain = getSiatDomain('stock.move', baseUser, effectivePermissions);
            const stockMoveDomain = basePickingDomain.map(d => {
                if (d[0] === 'picking_type_code') return ['picking_id.picking_type_code', d[1], d[2]];
                if (d[0] === 'user_id') return ['picking_id.user_id', d[1], d[2]];
                return d;
            });
            stockMoveDomain.push(['state', 'in', ['draft', 'waiting', 'confirmed', 'partially_available', 'assigned']]);

            const stockMoves = await callOdoo('stock.move', 'search_read', {
                domain: stockMoveDomain,
                fields: [
                    'picking_id', 'reference', 'product_id', 'product_uom_qty', 'product_uom',
                    'state', 'origin', 'partner_id', 'date', 'date_deadline', 'move_line_ids',
                    'company_id'
                ],
                limit: 500
            });

            if (stockMoves?.length > 0) {
                const allMoveLineIds = stockMoves.flatMap((sm: any) => sm.move_line_ids || []);
                if (allMoveLineIds.length > 0) {
                    const moveLines = await callOdoo('stock.move.line', 'search_read', {
                        domain: [['id', 'in', allMoveLineIds]],
                        fields: ['move_id', 'product_id', 'quantity', 'product_uom_id', 'lot_id', 'location_id', 'location_dest_id']
                    });
                    const linesByMoveId = new Map<number, any[]>();
                    for (const l of moveLines) {
                        const mid = Array.isArray(l.move_id) ? l.move_id[0] : l.move_id;
                        if (!linesByMoveId.has(mid)) linesByMoveId.set(mid, []);
                        linesByMoveId.get(mid)?.push(l);
                    }
                    for (const sm of stockMoves) sm.lines = linesByMoveId.get(sm.id) || [];
                }
                await db.clearTable('stock_moves');
                await db.clearTable('stock_move_lines');
                await db.saveStockMoves(stockMoves);
            }
        }

        // 5. Utility Data
        const hasOps = effectivePermissions.view_sales || effectivePermissions.view_receivables || effectivePermissions.view_pickings || effectivePermissions.is_admin;
        if (hasOps) {
            onProgress?.('Sincronizando productos y descuentos...');
            const products = await callOdoo('product.product', 'search_read', {
                domain: [['sale_ok', '=', true]],
                fields: ['display_name', 'list_price', 'qty_available', 'product_tmpl_id'],
                limit: 500
            });

            // Obtener items de lista de precios para estos productos
            let pricelistItems: any[] = [];
            try {
                const productIds = products.map((p: any) => p.id);
                const tmplIds = products.map((p: any) => Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id);
                
                pricelistItems = await callOdoo('product.pricelist.item', 'search_read', {
                    domain: ['|', ['product_id', 'in', productIds], ['product_tmpl_id', 'in', tmplIds]],
                    fields: ['product_id', 'product_tmpl_id', 'compute_price', 'percent_price', 'price_discount', 'min_quantity', 'date_start', 'date_end']
                });
            } catch (e) {
                console.warn('Error al sincronizar listas de precios:', e);
            }

            // Mapear descuentos a productos
            const productsWithMaxDiscount = products.map((p: any) => {
                const items = pricelistItems.filter((i: any) => 
                    (i.product_id && i.product_id[0] === p.id) || 
                    (i.product_tmpl_id && i.product_tmpl_id[0] === (Array.isArray(p.product_tmpl_id) ? p.product_tmpl_id[0] : p.product_tmpl_id))
                );
                
                const rules = items.map((item: any) => {
                    let discount = 0;
                    if (item.compute_price === 'percentage') {
                        discount = item.percent_price;
                    } else if (item.compute_price === 'formula') {
                        discount = item.price_discount;
                    }
                    return {
                        min_qty: item.min_quantity || 0,
                        discount: discount,
                        start: item.date_start || null,
                        end: item.date_end || null
                    };
                });

                // Ordenar reglas por cantidad mínima descendente para facilitar la evaluación
                rules.sort((a, b) => b.min_qty - a.min_qty);
                
                // Mantener max_discount como el descuento más alto posible (sin importar cantidad) para compatibilidad básica
                const overallMax = rules.length > 0 ? Math.max(...rules.map(r => r.discount)) : 0;

                return {
                    ...p,
                    max_discount: overallMax,
                    discount_rules: JSON.stringify(rules)
                };
            });

            console.log(`[SYNC] Productos procesados: ${productsWithMaxDiscount.length}.`);
            await db.clearTable('products');
            if (productsWithMaxDiscount.length > 0) await db.saveProducts(productsWithMaxDiscount);

            const journals = await callOdoo('account.journal', 'search_read', {
                domain: [['type', 'in', ['bank', 'cash']]],
                fields: ['name', 'type'],
            });
            await db.clearTable('account_journals');
            if (journals?.length > 0) await db.saveJournals(journals);
        }

        // 6. Historical Payments
        if (effectivePermissions.view_receivables || effectivePermissions.is_admin) {
            onProgress?.('Sincronizando cobranzas...');
            let paymentField = 'create_uid';
            let refField = '';
            try {
                const fieldsRes: any = await callOdoo('account.payment', 'fields_get', { attributes: ['string', 'store'] }, true);
                if (fieldsRes.kral_user_id) paymentField = 'kral_user_id';
                if (fieldsRes.ref?.store !== false) refField = 'ref';
                else if (fieldsRes.communication) refField = 'communication';
                else if (fieldsRes.memo) refField = 'memo';
            } catch (e) {
                console.warn('Field detection error');
            }

            const payDomain = getSiatDomain('account.payment', baseUser, effectivePermissions);
            if (!effectivePermissions.is_admin) {
                for (let i = 0; i < payDomain.length; i++) {
                    if (payDomain[i][0] === 'kral_user_id') payDomain[i][0] = paymentField;
                }
            }

            const payments = await callOdoo('account.payment', 'search_read', {
                domain: payDomain,
                fields: ['amount', 'date', 'journal_id', 'partner_id', 'company_id', paymentField, refField].filter(Boolean),
                limit: 200
            });

            const mappedPayments = payments.map((p: any) => ({
                ...p,
                user_id: p[paymentField],
                ref: refField ? (p[refField] || '') : ''
            }));
            await db.saveAccountPayments(mappedPayments);
        }

        onProgress?.('Sincronización completada.');
    } catch (error) {
        console.error('Critical sync error:', error);
        throw error;
    }
};

/**
 * Uploads records created or modified locally to Odoo.
 * Returns a report of successes and failures.
 */
export const uploadOfflineChanges = async (onProgress?: (msg: string) => void): Promise<{ success: boolean; errors: string[] }> => {
    const errorList: string[] = [];
    try {
        await db.initDB();
        onProgress?.('Buscando cambios locales...');
        
        // 1. Upload new Partners
        const localPartners = await db.getUnsyncedRecords('partners');
        for (const p of localPartners as any[]) {
            if (p.sync_status === 'new') {
                try {
                    onProgress?.(`Subiendo cliente: ${p.display_name}`);
                    const response = await callOdoo('res.partner', 'create', {
                        vals_list: [{
                            name: p.display_name,
                            email: p.email,
                            phone: p.phone,
                            partner_latitude: p.partner_latitude || 0,
                            partner_longitude: p.partner_longitude || 0
                        }]
                    }, true);
                    const newId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                    await db.markSynced('partners', p.id, newId);
                } catch (e: any) {
                    errorList.push(`Cliente ${p.display_name}: ${e.message}`);
                }
            } else if (p.sync_status === 'modified') {
                onProgress?.(`Actualizando cliente: ${p.display_name}`);
                await callOdoo('res.partner', 'write', {
                    ids: [p.id],
                    vals: {
                        name: p.display_name,
                        email: p.email,
                        phone: p.phone,
                        vat: p.vat,
                        street: p.street,
                        city: p.city,
                        zip: p.zip,
                        x_studio_razon_social: p.x_studio_razon_social,
                        x_studio_complemento: p.x_studio_complemento,
                        x_studio_giro: p.x_studio_giro,
                        x_studio_pago_a_proveedor: p.x_studio_pago_a_proveedor,
                        x_studio_pago_de_cliente: p.x_studio_pago_de_cliente,
                        x_studio_tipo_de_documento: p.x_studio_tipo_de_documento,
                        partner_latitude: p.partner_latitude || 0,
                        partner_longitude: p.partner_longitude || 0
                    }
                }, true);
                await db.markSynced('partners', p.id, p.id);
            }
        }

        // 2. Upload new Sale Orders
        const localOrders = await db.getUnsyncedRecords('sale_orders');
        for (const o of localOrders as any[]) {
                try {
                    let odooId = o.id;
                    const isNew = o.id < 0 || o.sync_status === 'new';

                    if (isNew) {
                        onProgress?.(`Creando pedido: ${o.name || 'Borrador'}`);
                        const lines = await db.getSaleOrderLines(o.id);
                        const orderLinesOdoo = lines.map((l: any) => {
                            const appliedDiscount = (o.global_discount && o.global_discount > 0) ? o.global_discount : (l.discount || 0);
                            return [0, 0, {
                                product_id: l.product_id,
                                product_uom_qty: l.product_uom_qty,
                                price_unit: l.price_unit,
                                discount: appliedDiscount
                            }];
                        });

                        const response = await callOdoo('sale.order', 'create', {
                            vals_list: [{
                                partner_id: o.partner_id ? (typeof o.partner_id === 'string' && o.partner_id.startsWith('[') ? JSON.parse(o.partner_id)[0] : o.partner_id) : 1,
                                user_id: o.user_id,
                                company_id: o.company_id || 1,
                                date_order: o.date_order,
                                order_line: orderLinesOdoo
                            }]
                        }, true);
                        odooId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                        await db.markSynced('sale_orders', o.id, odooId);
                        
                        // Sync lines IDs
                        const createdOrder: any = await callOdoo('sale.order', 'search_read', {
                            domain: [['id', '=', odooId]],
                            fields: ['order_line']
                        }, true);
                        if (createdOrder && createdOrder.length > 0) {
                            const odooLineIds = createdOrder[0].order_line;
                            const dbInst = await db.getDb();
                            for (let i = 0; i < Math.min(odooLineIds.length, lines.length); i++) {
                                await dbInst.runAsync('UPDATE sale_order_lines SET id = ?, sync_status = "synced" WHERE id = ?', [odooLineIds[i], (lines as any[])[i].id]);
                            }
                        }
                    }

                    // ACCIÓN DE NEGOCIO: Confirmar si el estado local es 'sale'
                    if (o.state === 'sale') {
                        onProgress?.(`Confirmando pedido: ${o.name || odooId}`);
                        await callOdoo('sale.order', 'action_confirm', { ids: [odooId] }, true);
                        // Mark as synced again to clear the modified status if it was just a confirmation
                        await db.markSynced('sale_orders', odooId, odooId);
                    }
                } catch (e: any) {
                    errorList.push(`Pedido ${o.name || 'Local'}: ${e.message}`);
                }
        }

        // 3. Upload new Invoices
        const localInvoices = await db.getUnsyncedRecords('account_moves');
        for (const inv of localInvoices as any[]) {
                try {
                    let odooInvId = inv.id;
                    const isNew = inv.id < 0 || inv.sync_status === 'new';

                    if (isNew) {
                        onProgress?.(`Subiendo factura: ${inv.name}`);
                        let originOrderIdOdoo = null;
                        let orderName = inv.name; 
                        if (inv.origin_order_id) {
                            const order: any = await db.getDb().then(dbInst => 
                                dbInst.getFirstAsync('SELECT id, name FROM sale_orders WHERE id = ?', [inv.origin_order_id])
                            );
                            if (order) {
                                if (order.id > 0) originOrderIdOdoo = order.id;
                                if (order.name) orderName = order.name;
                            }
                        }

                        if (originOrderIdOdoo && originOrderIdOdoo > 0) {
                            onProgress?.(`Facturando pedido Odoo: ${orderName}`);
                            const orderOdoo: any = await callOdoo('sale.order', 'search_read', {
                                domain: [['id', '=', originOrderIdOdoo]],
                                fields: ['state', 'partner_id']
                            }, true);
                            
                            if (orderOdoo.length > 0 && ['draft', 'sent'].includes(orderOdoo[0].state)) {
                                onProgress?.(`Confirmando pedido Odoo: ${orderName}`);
                                await callOdoo('sale.order', 'action_confirm', { ids: [originOrderIdOdoo] }, true);
                            }

                            const soLines: any = await callOdoo('sale.order.line', 'search_read', {
                                domain: [['order_id', '=', originOrderIdOdoo]],
                                fields: ['id', 'product_id', 'name', 'product_uom_qty', 'price_unit']
                            }, true);

                            const dbInst = await db.getDb();
                            const localLines: any[] = await dbInst.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [inv.id]);
                            
                            const invoiceLinesOdoo = localLines.map(l => {
                                const matchingLine = soLines.find((sol: any) => 
                                    sol.product_id[0] === (typeof l.product_id === 'number' ? l.product_id : 0) ||
                                    sol.name === l.product_name
                                );

                                return [0, 0, {
                                    name: l.product_name,
                                    quantity: l.quantity,
                                    price_unit: l.price_unit,
                                    sale_line_ids: matchingLine ? [[4, matchingLine.id]] : []
                                }];
                            });

                            const invoiceVals = {
                                move_type: 'out_invoice',
                                partner_id: orderOdoo.length > 0 ? orderOdoo[0].partner_id[0] : (inv.partner_id ? (typeof inv.partner_id === 'string' && inv.partner_id.startsWith('[') ? JSON.parse(inv.partner_id)[0] : inv.partner_id) : 1),
                                invoice_user_id: inv.invoice_user_id,
                                company_id: inv.company_id || 1,
                                invoice_date: inv.invoice_date,
                                invoice_line_ids: invoiceLinesOdoo,
                                invoice_origin: orderName,
                            };

                            const response = await callOdoo('account.move', 'create', { vals_list: [invoiceVals] }, true);
                            odooInvId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);

                            if (odooInvId) {
                                onProgress?.(`Publicando factura: ${odooInvId}`);
                                await callOdoo('account.move', 'action_post', { ids: [odooInvId] }, true);
                                await db.markSynced('account_moves', inv.id, odooInvId);
                            }
                        } else {
                            // Fallback: Manual creation (only if no origin order, e.g. direct invoice)
                            const dbInst = await db.getDb();
                            const lines: any[] = await dbInst.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [inv.id]);
                            
                            const invoiceLinesOdoo = lines.map(l => [0, 0, {
                                name: l.product_name,
                                quantity: l.quantity,
                                price_unit: l.price_unit,
                            }]);

                            const invoiceVals = {
                                move_type: 'out_invoice',
                                partner_id: inv.partner_id ? (typeof inv.partner_id === 'string' && inv.partner_id.startsWith('[') ? JSON.parse(inv.partner_id)[0] : inv.partner_id) : 1,
                                invoice_user_id: inv.invoice_user_id,
                                company_id: inv.company_id || 1,
                                invoice_date: inv.invoice_date,
                                invoice_line_ids: invoiceLinesOdoo,
                                invoice_origin: orderName,
                            };

                            const response = await callOdoo('account.move', 'create', { vals_list: [invoiceVals] }, true);
                            odooInvId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                            
                            if (odooInvId) {
                                onProgress?.(`Publicando factura: ${odooInvId}`);
                                await callOdoo('account.move', 'action_post', { ids: [odooInvId] }, true);
                                await db.markSynced('account_moves', inv.id, odooInvId);
                            }
                        }
                    }

                    // ACCIÓN DE NEGOCIO: Enviar al SIAT si está marcado
                    if (inv.siat_status === 'to_send') {
                        onProgress?.(`Enviando a SIAT: ${inv.name || odooInvId}`);
                        await callOdoo('account.move', 'action_send_siat', { ids: [odooInvId] }, true);
                        // Mark as synced again
                        await db.markSynced('account_moves', odooInvId, odooInvId);
                    }
                } catch (e: any) {
                    errorList.push(`Factura ${inv.name}: ${e.message}`);
                }
        }

        // 4. Upload new Payments
        const localStockMoves = (await db.getUnsyncedRecords('stock_moves')) as any[];
        const stockMoveGroups = new Map<number, any[]>();
        for (const move of localStockMoves) {
            if (move.sync_status === 'modified' && move.pending_delivery_qty && move.picking_id) {
                if (!stockMoveGroups.has(move.picking_id)) {
                    stockMoveGroups.set(move.picking_id, []);
                }
                stockMoveGroups.get(move.picking_id)?.push(move);
            }
        }

        for (const [pickingId, groupMoves] of stockMoveGroups.entries()) {
            onProgress?.(`Entregando transferencia: ${groupMoves[0]?.reference || pickingId}`);
            try {
                await submitPickingDelivery(
                    pickingId,
                    groupMoves.map((move) => ({
                        moveId: move.id,
                        quantity: move.pending_delivery_qty
                    })),
                    true
                );
                for (const move of groupMoves) {
                    await db.clearPendingStockMoveDelivery(move.id);
                }
            } catch (stockErr: any) {
                console.error(`Error al entregar transferencia ${pickingId}: ${stockErr.message}`);
            }
        }

        // 5. Upload new Payments
        const localPayments = await db.getUnsyncedRecords('account_payments');
        for (const p of localPayments as any[]) {
            if (p.sync_status === 'new') {
                try {
                    onProgress?.(`Subiendo pago: Bs. ${p.amount}`);
                    const wizContext = {
                        active_model: 'account.move',
                        active_ids: [p.invoice_id]
                    };
                    const wizVals = {
                        amount: p.amount,
                        payment_date: p.payment_date,
                        journal_id: p.journal_id,
                        communication: p.memo || `Pago desde móvil`
                    };

                    const wizRes: any = await callOdoo('account.payment.register', 'create', {
                        vals_list: [wizVals],
                        context: wizContext
                    }, true);

                    const wizId = Array.isArray(wizRes) ? (wizRes[0].id || wizRes[0]) : (wizRes.id || wizRes);

                    if (wizId) {
                        onProgress?.(`Conciliando pago...`);
                        const payRes: any = await callOdoo('account.payment.register', 'action_create_payments', {
                            ids: [wizId],
                            context: wizContext
                        }, true);
                        const newPaymentId = payRes && payRes.res_id ? payRes.res_id : wizId;
                        await db.markSynced('account_payments', p.id, newPaymentId);
                    }
                } catch (e: any) {
                    errorList.push(`Pago Bs. ${p.amount}: ${e.message}`);
                }
            }
        }

        onProgress?.(errorList.length === 0 ? 'Cambios locales subidos con éxito.' : 'Subida completada con algunos errores.');
        return { success: errorList.length === 0, errors: errorList };
    } catch (error: any) {
        console.error('Error uploading changes:', error);
        return { success: false, errors: [error.message] };
    }
};

/**
 * Unified bidirectional sync: Upload first, then download.
 * Acts as a "Manual Flush" that ignores the isOffline setting.
 */
export const uploadAndSync = async (onProgress?: (msg: string) => void): Promise<{ success: boolean; errors: string[] }> => {
    try {
        const uploadRes = await uploadOfflineChanges(onProgress);
        await runSync(onProgress);
        return uploadRes;
    } catch (e: any) {
        console.error('[SYNC] Bidirectional sync failed:', e);
        return { success: false, errors: [e.message] };
    }
};

/**
 * High-safety logout: Forces push of local changes before clearing DB.
 * Returns { success: boolean, message: string }
 */
export const performSafeLogout = async (onProgress?: (msg: string) => void): Promise<{ success: boolean; message: string }> => {
    try {
        await db.initDB();
        const unsyncedCount = await db.getUnsyncedCount();
        
        if (unsyncedCount > 0) {
            onProgress?.(`Detectados ${unsyncedCount} cambios pendientes. Intentando subir...`);
            const { success, errors } = await uploadOfflineChanges(onProgress);
            
            if (!success) {
                // If it's a connectivity error (likely if many records fail at once)
                const isConnectionError = errors.some(e => e.toLowerCase().includes('timeout') || e.toLowerCase().includes('network'));
                
                if (isConnectionError) {
                    return { 
                        success: false, 
                        message: 'Error de conexión con Odoo. Por favor, asegúrese de tener internet estable para subir sus cambios antes de salir.' 
                    };
                } else {
                    return { 
                        success: false, 
                        message: `Odoo rechazó algunos datos:\n\n${errors.slice(0, 3).join('\n')}${errors.length > 3 ? '\n...' : ''}\n\nDebe corregir estos errores para cerrar sesión de forma segura.` 
                    };
                }
            }

            // Re-verify after sync attempt
            const remaining = await db.getUnsyncedCount();
            if (remaining > 0) {
                return { 
                    success: false, 
                    message: `No se pudieron subir ${remaining} registros. Verifique su conexión para no perder datos antes de salir.` 
                };
            }
        }
        
        // If we reached here, data is synced or there was nothing to sync
        await backupAndPurgeDatabase(onProgress);
        return { success: true, message: 'Sesión cerrada con éxito tras sincronización total.' };
        
    } catch (error: any) {
        console.error('[SAFE LOGOUT] Critical error:', error);
        return { success: false, message: 'Ocurrió un error crítico: ' + error.message };
    }
};

/**
 * Creates a backup of the current database and clears local tables
 */
export const backupAndPurgeDatabase = async (onProgress?: (msg: string) => void) => {
    try {
        onProgress?.('Creando copia de seguridad...');
        
        // Fix DB name to match actual DB from dbService
        const dbName = 'odoo_siat_v2.db';
        const dbPath = `${FileSystem.documentDirectory}SQLite/${dbName}`;
        const backupDir = `${FileSystem.documentDirectory}Backups/`;
        const timestamp = new Date().getTime();
        const backupPath = `${backupDir}${dbName.replace('.db', '')}_backup_${timestamp}.db`;

        const dirInfo = await FileSystem.getInfoAsync(backupDir);
        if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(backupDir, { intermediates: true });
        }

        await FileSystem.copyAsync({
            from: dbPath,
            to: backupPath
        });

        onProgress?.('Limpiando base de datos local...');
        await db.deleteLocalDatabase();
        
        onProgress?.('Backup y limpieza completados.');
    } catch (error) {
        console.error('Error during backup/purge:', error);
        throw error;
    }
};

/**
 * Sincroniza facturas específicas por sus IDs.
 * Útil para asegurarse de que las facturas de los pedidos recién descargados
 * estén disponibles localmente.
 */
export const syncInvoicesByIds = async (invoiceIds: number[]) => {
    if (!invoiceIds || invoiceIds.length === 0) return;
    
    const validIds = Array.from(new Set(invoiceIds.filter(id => !!id && id > 0)));
    if (validIds.length === 0) return;

    console.log(`[SYNC-INC] Iniciando descarga incremental de ${validIds.length} facturas...`);
    try {
        const moves = await callOdoo('account.move', 'search_read', {
            domain: [['id', 'in', validIds]],
            fields: [
                'name', 'partner_id', 'move_type', 'state', 'payment_state',
                'invoice_date', 'invoice_date_due', 'amount_total',
                'amount_residual', 'invoice_line_ids', 'invoice_user_id', 'company_id',
                'siat_estado', 'siat_qr_string', 'siat_qr_image', 'siat_cuf'
            ],
            limit: validIds.length
        });

        if (moves && moves.length > 0) {
            console.log(`[SYNC-INC] Recuperadas ${moves.length} cabeceras. Buscando líneas...`);
            const moveIds = moves.map((m: any) => m.id);
            const moveLines = await callOdoo('account.move.line', 'search_read', {
                domain: [['move_id', 'in', moveIds], ['display_type', 'not in', ['line_section', 'line_note']]],
                fields: [
                    'move_id', 'product_id', 'quantity', 'price_unit', 'price_subtotal',
                    'debit', 'credit', 'name', 'product_uom_id', 'date_maturity'
                ]
            });

            console.log(`[SYNC-INC] Recuperadas ${moveLines.length} líneas totales.`);
            const linesByMoveId = new Map<number, any[]>();
            moveLines.forEach((l: any) => {
                const mid = Array.isArray(l.move_id) ? l.move_id[0] : l.move_id;
                if (!linesByMoveId.has(mid)) linesByMoveId.set(mid, []);
                linesByMoveId.get(mid)?.push(l);
            });

            moves.forEach((m: any) => {
                m.lines = linesByMoveId.get(m.id) || [];
            });

            await db.saveAccountMoves(moves);
            console.log('[SYNC-INC] Facturas incrementales guardadas con éxito.');
        } else {
            console.log('[SYNC-INC] No se encontraron las facturas solicitadas en Odoo.');
        }
    } catch (e) {
        console.error('[SYNC-INC] Error crítico en sincronización incremental:', e);
    }
};
