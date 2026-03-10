import { callOdoo } from '../api/odooClient';
import * as db from './dbService';
import * as FileSystem from 'expo-file-system/legacy';

export const runSync = async (onProgress?: (msg: string) => void) => {
    try {
        onProgress?.('Iniciando sincronización...');
        await db.initDB();

        // 1. Sync Partners
        onProgress?.('Sincronizando clientes...');
        const partners = await callOdoo('res.partner', 'search_read', {
            fields: [
                "display_name", "email", "phone", "lang", "vat",
                "street", "street2", "city", "zip",
                "credit", "debit", "credit_limit", "total_due", "total_overdue",
                "comment", "image_128",
                "x_studio_complemento", "x_studio_giro", 
                "x_studio_pago_a_proveedor", "x_studio_pago_de_cliente", 
                "x_studio_razon_social", "x_studio_tipo_de_documento"
            ],
            limit: 500
        });
        await db.clearTable('partners');
        await db.savePartners(partners);

        // 2. Sync Sale Orders
        onProgress?.('Sincronizando ventas...');
        const orders = await callOdoo('sale.order', 'search_read', {
            fields: ["name", "display_name", "partner_id", "date_order", "state", "amount_total", "order_line", "invoice_ids"],
            limit: 50
        });

        const allOrderLineIds = orders.flatMap((o: any) => o.order_line);
        if (allOrderLineIds.length > 0) {
            const lines = await callOdoo('sale.order.line', 'search_read', {
                domain: [['id', 'in', allOrderLineIds]],
                fields: ["product_id", "product_uom_qty", "price_unit", "price_subtotal"]
            });
            orders.forEach((o: any) => {
                o.lines_data = lines.filter((l: any) => o.order_line.includes(l.id));
            });
        }
        await db.clearTable('sale_orders');
        await db.clearTable('sale_order_lines');
        await db.saveSaleOrders(orders);

        // 3. Sync Account Moves (Cobranzas)
        onProgress?.('Sincronizando cobranzas...');
        const moves = await callOdoo('account.move', 'search_read', {
            domain: [
                ['move_type', '=', 'out_invoice'],
                ['state', '=', 'posted'],
                ['payment_state', 'in', ['not_paid', 'partial']]
            ],
            fields: [
                'name', 'partner_id', 'invoice_date', 'invoice_date_due', 
                'amount_total', 'amount_residual', 'invoice_line_ids'
            ],
            limit: 50
        });

        for (const move of moves) {
            if (move.invoice_line_ids?.length > 0) {
                move.lines = await callOdoo('account.move.line', 'search_read', {
                    domain: [
                        ['move_id', '=', move.id],
                        ['display_type', 'not in', ['line_section', 'line_note']]
                    ],
                    fields: [
                        'product_id', 'quantity', 'price_unit', 'price_subtotal', 
                        'debit', 'credit', 'name', 'product_uom_id'
                    ]
                });
            }
        }
        await db.clearTable('account_moves');
        await db.clearTable('account_move_lines');
        await db.saveAccountMoves(moves);

        // 4. Sync Stock Moves (Distribucion)
        onProgress?.('Sincronizando distribución...');
        const stockMoves = await callOdoo('stock.move', 'search_read', {
            domain: [['state', '=', 'assigned']],
            fields: [
                'reference', 'product_id', 'product_uom_qty', 'product_uom',
                'state', 'origin', 'partner_id', 'date', 'date_deadline', 'move_line_ids'
            ],
            limit: 50
        });

        for (const sm of stockMoves) {
            if (sm.move_line_ids?.length > 0) {
                sm.lines = await callOdoo('stock.move.line', 'search_read', {
                    domain: [['move_id', '=', sm.id]],
                    fields: [
                        'product_id', 'quantity', 'product_uom_id', 
                        'lot_id', 'location_id', 'location_dest_id'
                    ]
                });
            }
        }
        await db.clearTable('stock_moves');
        await db.clearTable('stock_move_lines');
        await db.saveStockMoves(stockMoves);

        // 5. Sync Products (for sales creation offline search)
        onProgress?.('Sincronizando productos...');
        const products = await callOdoo('product.product', 'search_read', {
            domain: [['sale_ok', '=', true]],
            fields: ['display_name', 'list_price'],
            limit: 500
        });
        await db.clearTable('products');
        await db.saveProducts(products);

        // 6. Sync Journals (Payment Methods)
        onProgress?.('Sincronizando métodos de pago...');
        const journals = await callOdoo('account.journal', 'search_read', {
            domain: [['type', 'in', ['bank', 'cash']]],
            fields: ['name', 'type'],
        });
        await db.clearTable('account_journals');
        await db.saveJournals(journals);

        onProgress?.('Sincronización completada.');
    } catch (error) {
        console.error('Error during sync:', error);
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
                    }]
                });
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
                        x_studio_tipo_de_documento: p.x_studio_tipo_de_documento
                    }
                });
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
                        partner_id: o.partner_id ? (o.partner_id.startsWith('[') ? JSON.parse(o.partner_id)[0] : o.partner_id) : 1,
                        date_order: o.date_order,
                        order_line: orderLinesOdoo
                    }]
                });
                // Extract ID from Odoo response
                const newOrderId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                
                await db.markSynced('sale_orders', o.id, newOrderId);
                
                // Fetch the created order to get the Odoo IDs for the lines
                try {
                    const createdOrder: any = await callOdoo('sale.order', 'search_read', {
                        domain: [['id', '=', newOrderId]],
                        fields: ['order_line']
                    });
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
                        });
                        
                        if (orderOdoo.length > 0 && ['draft', 'sent'].includes(orderOdoo[0].state)) {
                            onProgress?.(`Confirmando pedido Odoo: ${orderName}`);
                            await callOdoo('sale.order', 'action_confirm', { ids: [originOrderIdOdoo] });
                        }

                        // 2. Fetch origin order lines to correctly link the invoice lines
                        const soLines: any = await callOdoo('sale.order.line', 'search_read', {
                            domain: [['order_id', '=', originOrderIdOdoo]],
                            fields: ['id', 'product_id', 'name', 'product_uom_qty', 'price_unit']
                        });

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
                            invoice_date: inv.invoice_date,
                            invoice_line_ids: invoiceLinesOdoo,
                            invoice_origin: orderName,
                        };

                        const response = await callOdoo('account.move', 'create', { vals_list: [invoiceVals] });
                        const newInvId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);

                        if (newInvId) {
                            onProgress?.(`Publicando factura: ${newInvId}`);
                            await callOdoo('account.move', 'action_post', { ids: [newInvId] });
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
                    invoice_date: inv.invoice_date,
                    invoice_line_ids: invoiceLinesOdoo,
                    invoice_origin: orderName, // Formal link via string origin
                };

                console.log('Enviando factura a Odoo:', JSON.stringify(invoiceVals, null, 2));

                const response = await callOdoo('account.move', 'create', {
                    vals_list: [invoiceVals]
                });
                
                console.log('Respuesta de Odoo (Factura):', JSON.stringify(response, null, 2));
                
                const newInvId = Array.isArray(response) ? (response[0].id || response[0]) : (response.id || response);
                
                if (newInvId) {
                    // Step 3b. Post the invoice automatically
                    onProgress?.(`Publicando factura: ${newInvId}`);
                    try {
                        await callOdoo('account.move', 'action_post', {
                            ids: [newInvId]
                        });
                        console.log(`Factura ${newInvId} publicada con éxito.`);
                        
                        // Step 3c. Explicitly link to Sale Order if origin ID is known
                        if (originOrderIdOdoo && originOrderIdOdoo > 0) {
                            onProgress?.(`Vinculando factura a la venta...`);
                            await callOdoo('sale.order', 'write', {
                                ids: [originOrderIdOdoo],
                                vals: {
                                    invoice_ids: [[4, newInvId]] // 4: Link existing record
                                }
                            });
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
                    });

                    const wizId = Array.isArray(wizRes) ? (wizRes[0].id || wizRes[0]) : (wizRes.id || wizRes);

                    if (wizId) {
                        onProgress?.(`Conciliando pago con factura...`);
                        const payRes: any = await callOdoo('account.payment.register', 'action_create_payments', {
                            ids: [wizId],
                            context: wizContext
                        });

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
