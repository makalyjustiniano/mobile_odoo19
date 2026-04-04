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
                limit: 50
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

        // 3. Sync Account Moves
        if (effectivePermissions.view_receivables || effectivePermissions.is_admin) {
            onProgress?.('Sincronizando deudas...');
            const invoiceDomain = getSiatDomain('account.move', baseUser, effectivePermissions);
            const pendingMoves = await callOdoo('account.move', 'search_read', {
                domain: invoiceDomain,
                fields: [
                    'name', 'partner_id', 'move_type', 'state', 'payment_state',
                    'invoice_date', 'invoice_date_due', 'amount_total',
                    'amount_residual', 'invoice_line_ids', 'invoice_user_id', 'company_id',
                    'siat_estado', 'siat_qr_string', 'siat_qr_image', 'siat_cuf'
                ],
                limit: 200
            });

            const saleInvoiceIds = Array.from(new Set(
                (orders || []).flatMap((o: any) => Array.isArray(o.invoice_ids) ? o.invoice_ids : [])
            ));

            let saleMoves: any[] = [];
            if (saleInvoiceIds.length > 0) {
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

            const moveMap = new Map<number, any>();
            [...pendingMoves, ...saleMoves].forEach((move: any) => {
                if (move?.id) moveMap.set(move.id, move);
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

            await db.clearTable('account_moves');
            await db.clearTable('account_move_lines');
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
            onProgress?.('Sincronizando productos y métodos...');
            const products = await callOdoo('product.product', 'search_read', {
                domain: [['sale_ok', '=', true]],
                fields: ['display_name', 'list_price', 'qty_available'],
                limit: 500
            });
            console.log(`[SYNC] Productos recibidos: ${products?.length}. Primer producto:`, products?.[0] ? JSON.stringify(products[0]) : 'vacío');
            await db.clearTable('products');
            if (products?.length > 0) await db.saveProducts(products);

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
 * Uploads records created or modified locally to Odoo
 */
export const uploadOfflineChanges = async (onProgress?: (msg: string) => void) => {
    try {
        await db.initDB();
        onProgress?.('Buscando cambios locales...');
        
        // 1. Upload new Partners
        const localPartners = await db.getUnsyncedRecords('partners');
        for (const p of localPartners as any[]) {
            if (p.sync_status === 'new') {
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
                // Extract ID from Odoo response
                const newId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                await db.markSynced('partners', p.id, newId);
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
            if (o.sync_status === 'new') {
                onProgress?.(`Subiendo pedido: ${o.name || 'Borrador'}`);
                
                // Get lines for this order
                const lines = await db.getSaleOrderLines(o.id);
                const orderLinesOdoo = lines.map((l: any) => [0, 0, {
                    product_id: l.product_id,
                    product_uom_qty: l.product_uom_qty,
                    price_unit: l.price_unit
                }]);

                const response = await callOdoo('sale.order', 'create', {
                    vals_list: [{
                        partner_id: o.partner_id ? (typeof o.partner_id === 'string' && o.partner_id.startsWith('[') ? JSON.parse(o.partner_id)[0] : o.partner_id) : 1,
                        date_order: o.date_order,
                        order_line: orderLinesOdoo
                    }]
                }, true);
                // Extract ID from Odoo response
                const newOrderId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                
                await db.markSynced('sale_orders', o.id, newOrderId);
                
                // Fetch the created order to get the Odoo IDs for the lines
                try {
                    const createdOrder: any = await callOdoo('sale.order', 'search_read', {
                        domain: [['id', '=', newOrderId]],
                        fields: ['order_line']
                    }, true);
                    if (createdOrder && createdOrder.length > 0 && createdOrder[0].order_line.length === lines.length) {
                        const odooLineIds = createdOrder[0].order_line;
                        const dbInst = await db.getDb();
                        for (let i = 0; i < (lines as any[]).length; i++) {
                            await dbInst.runAsync('UPDATE sale_order_lines SET id = ?, sync_status = "synced" WHERE id = ?', [odooLineIds[i], (lines as any[])[i].id]);
                        }
                    }
                } catch (lineErr) {
                    console.error('Error fetching/updating synced sale order lines:', lineErr);
                }
            }
        }

        // 3. Upload new Invoices
        const localInvoices = await db.getUnsyncedRecords('account_moves');
        for (const inv of localInvoices as any[]) {
            if (inv.sync_status === 'new') {
                onProgress?.(`Subiendo factura: ${inv.name}`);
                
                // Get origin order mapping if it exists
                let originOrderIdOdoo = null;
                let orderName = inv.name; // Fallback
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
                    try {
                        // 1. Confirm order if needed (Check state first to avoid UserError if already confirmed)
                        const orderOdoo: any = await callOdoo('sale.order', 'search_read', {
                            domain: [['id', '=', originOrderIdOdoo]],
                            fields: ['state', 'partner_id']
                        }, true);
                        
                        if (orderOdoo.length > 0 && ['draft', 'sent'].includes(orderOdoo[0].state)) {
                            onProgress?.(`Confirmando pedido Odoo: ${orderName}`);
                            await callOdoo('sale.order', 'action_confirm', { ids: [originOrderIdOdoo] }, true);
                        }

                        // 2. Fetch origin order lines to correctly link the invoice lines
                        const soLines: any = await callOdoo('sale.order.line', 'search_read', {
                            domain: [['order_id', '=', originOrderIdOdoo]],
                            fields: ['id', 'product_id', 'name', 'product_uom_qty', 'price_unit']
                        }, true);

                        // 3. Create the invoice manually with line linking
                        const dbInst = await db.getDb();
                        const localLines: any[] = await dbInst.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [inv.id]);
                        
                        const invoiceLinesOdoo = localLines.map(l => {
                            // Try to find matching SO line by product
                            // Note: This is a heuristic if we don't have the exact sync mapping yet
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
                            invoice_user_id: inv.invoice_user_id, // Atribución al usuario mobile
                            invoice_date: inv.invoice_date,
                            invoice_line_ids: invoiceLinesOdoo,
                            invoice_origin: orderName,
                        };

                        const response = await callOdoo('account.move', 'create', { vals_list: [invoiceVals] }, true);
                        const newInvId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);

                        if (newInvId) {
                            onProgress?.(`Publicando factura: ${newInvId}`);
                            await callOdoo('account.move', 'action_post', { ids: [newInvId] }, true);
                            await db.markSynced('account_moves', inv.id, newInvId);
                            console.log(`Pedido ${orderName} facturado manual-link con éxito.`);
                        }
                    } catch (e: any) {
                        console.error(`Error en facturación manual-link para ${orderName}:`, e.message);
                    }
                    continue; 
                }

                // Fallback: Manual creation (only if no origin order, e.g. direct invoice)
                // Fetch invoice lines
                const dbInst = await db.getDb();
                const lines: any[] = await dbInst.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [inv.id]);
                
                // Odoo 19 account.move.line needs specific fields. 
                // Using invoice_line_ids automatically handles some aspects, 
                // but we should ensure partner_id is consistent if required.
                const invoiceLinesOdoo = lines.map(l => [0, 0, {
                    name: l.product_name,
                    quantity: l.quantity,
                    price_unit: l.price_unit,
                }]);

                const invoiceVals = {
                    move_type: 'out_invoice',
                    partner_id: inv.partner_id ? (typeof inv.partner_id === 'string' && inv.partner_id.startsWith('[') ? JSON.parse(inv.partner_id)[0] : inv.partner_id) : 1,
                    invoice_user_id: inv.invoice_user_id, // Atribución al usuario mobile
                    invoice_date: inv.invoice_date,
                    invoice_line_ids: invoiceLinesOdoo,
                    invoice_origin: orderName, // Formal link via string origin
                };

                console.log('Enviando factura a Odoo:', JSON.stringify(invoiceVals, null, 2));

                const response = await callOdoo('account.move', 'create', {
                    vals_list: [invoiceVals]
                }, true);
                
                console.log('Respuesta de Odoo (Factura):', JSON.stringify(response, null, 2));
                
                const newInvId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                
                if (newInvId) {
                    // Step 3b. Post the invoice automatically
                    onProgress?.(`Publicando factura: ${newInvId}`);
                    try {
                        await callOdoo('account.move', 'action_post', {
                            ids: [newInvId]
                        }, true);
                        console.log(`Factura ${newInvId} publicada con éxito.`);
                        
                        // Step 3c. Explicitly link to Sale Order if origin ID is known
                        if (originOrderIdOdoo && originOrderIdOdoo > 0) {
                            onProgress?.(`Vinculando factura a la venta...`);
                            await callOdoo('sale.order', 'write', {
                                ids: [originOrderIdOdoo],
                                vals: {
                                    invoice_ids: [[4, newInvId]] // 4: Link existing record
                                }
                            }, true);
                            console.log(`Venta ${originOrderIdOdoo} vinculada a factura ${newInvId}.`);
                        }
                    } catch (postError) {
                        console.error(`Error al publicar factura ${newInvId}:`, postError);
                        // We don't throw here to avoid stopping the whole sync, 
                        // but the invoice is already created in draft.
                    }
                    
                    await db.markSynced('account_moves', inv.id, newInvId);
                } else {
                    console.error('No se recibió ID de la factura creada');
                }
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
                onProgress?.(`Subiendo pago: Bs. ${p.amount}`);
                try {
                    // Use account.payment.register wizard to ensure reconciliation with invoice
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
                        onProgress?.(`Conciliando pago con factura...`);
                        const payRes: any = await callOdoo('account.payment.register', 'action_create_payments', {
                            ids: [wizId],
                            context: wizContext
                        }, true);

                        // Extract payment ID from action response if available, else just mark p.id as synced
                        const newPaymentId = payRes && payRes.res_id ? payRes.res_id : wizId;

                        await db.markSynced('account_payments', p.id, newPaymentId);
                        console.log(`Pago ${newPaymentId} registrado y conciliado con éxito.`);
                    }
                } catch (payErr: any) {
                    console.error(`Error al subir pago: ${payErr.message}`);
                }
            }
        }

        onProgress?.('Cambios locales subidos con éxito.');
    } catch (error) {
        console.error('Error uploading changes:', error);
        throw error;
    }
};

/**
 * Creates a backup of the current database and clears local tables
 */
export const backupAndPurgeDatabase = async (onProgress?: (msg: string) => void) => {
    try {
        onProgress?.('Creando copia de seguridad...');
        
        const dbPath = `${FileSystem.documentDirectory}SQLite/odoo_offline.db`;
        const backupDir = `${FileSystem.documentDirectory}Backups/`;
        const timestamp = new Date().getTime();
        const backupPath = `${backupDir}odoo_backup_${timestamp}.db`;

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
