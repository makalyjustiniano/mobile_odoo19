import * as SQLite from 'expo-sqlite';

const DB_NAME = 'odoo_offline.db';
let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Singleton-like getter for the database connection.
 * Ensures openDatabaseAsync is only called once and returns the same instance.
 */
export const getDb = async () => {
    if (dbInstance) return dbInstance;
    if (dbPromise) return dbPromise;

    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(db => {
        dbInstance = db;
        dbPromise = null;
        return db;
    });

    return dbPromise;
};

export const initDB = async () => {
    console.log('Initializing SQLite database...');
    const db = await getDb();

    // Create Tables individually for better reliability
    await db.runAsync('PRAGMA journal_mode = WAL');

    // 1. Create all tables first
    const createTables = [
        `CREATE TABLE IF NOT EXISTS partners (
            id INTEGER PRIMARY KEY,
            display_name TEXT,
            email TEXT,
            phone TEXT,
            lang TEXT,
            vat TEXT,
            street TEXT,
            street2 TEXT,
            city TEXT,
            zip TEXT,
            credit REAL,
            debit REAL,
            credit_limit REAL,
            total_due REAL,
            total_overdue REAL,
            comment TEXT,
            x_studio_razon_social TEXT,
            image_128 TEXT,
            metadata TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS sale_orders (
            id INTEGER PRIMARY KEY,
            name TEXT,
            display_name TEXT,
            partner_name TEXT,
            date_order TEXT,
            state TEXT,
            amount_total REAL,
            invoice_id INTEGER,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS sale_order_lines (
            id INTEGER PRIMARY KEY,
            order_id INTEGER,
            product_id INTEGER,
            product_name TEXT,
            product_uom_qty REAL,
            price_unit REAL,
            price_subtotal REAL,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0,
            FOREIGN KEY(order_id) REFERENCES sale_orders(id)
        )`,
        `CREATE TABLE IF NOT EXISTS account_moves (
            id INTEGER PRIMARY KEY,
            name TEXT,
            partner_name TEXT,
            move_type TEXT,
            state TEXT,
            payment_state TEXT,
            invoice_date TEXT,
            invoice_date_due TEXT,
            amount_total REAL,
            amount_residual REAL,
            origin_order_id INTEGER,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS account_move_lines (
            id INTEGER PRIMARY KEY,
            move_id INTEGER,
            product_name TEXT,
            quantity REAL,
            price_unit REAL,
            price_subtotal REAL,
            debit REAL,
            credit REAL,
            uom_name TEXT,
            sale_line_id INTEGER,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0,
            FOREIGN KEY(move_id) REFERENCES account_moves(id)
        )`,
        `CREATE TABLE IF NOT EXISTS stock_moves (
            id INTEGER PRIMARY KEY,
            picking_id INTEGER,
            reference TEXT,
            product_name TEXT,
            product_uom_qty REAL,
            uom_name TEXT,
            state TEXT,
            origin TEXT,
            partner_name TEXT,
            date TEXT,
            date_deadline TEXT,
            pending_delivery_qty REAL,
            pending_delivery_date TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS stock_move_lines (
            id INTEGER PRIMARY KEY,
            move_id INTEGER,
            product_name TEXT,
            quantity REAL,
            uom_name TEXT,
            lot_name TEXT,
            location_name TEXT,
            location_dest_name TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0,
            FOREIGN KEY(move_id) REFERENCES stock_moves(id)
        )`,
        `CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            display_name TEXT,
            list_price REAL,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS account_journals (
            id INTEGER PRIMARY KEY,
            name TEXT,
            type TEXT,
            sync_status TEXT DEFAULT 'synced'
        )`,
        `CREATE TABLE IF NOT EXISTS account_payments (
            id INTEGER PRIMARY KEY,
            amount REAL,
            payment_date TEXT,
            journal_id INTEGER,
            partner_id INTEGER,
            invoice_id INTEGER,
            memo TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`
    ];

    for (const sql of createTables) {
        await db.runAsync(sql);
    }

    // 2. Migration logic: Check if columns exist before adding them
    const addColumnIfMissing = async (tableName: string, columnName: string, columnDef: string) => {
        try {
            const tableInfo: any[] = await db.getAllAsync(`PRAGMA table_info(${tableName})`);
            const hasColumn = tableInfo.some(col => col.name === columnName);
            
            if (!hasColumn) {
                console.log(`Adding column ${columnName} to ${tableName}...`);
                await db.runAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
            }
        } catch (e) {
            console.error(`Error migrating table ${tableName}:`, e);
        }
    };

    const tablesToMigrate = [
        'partners', 'sale_orders', 'sale_order_lines', 
        'account_moves', 'account_move_lines', 
        'stock_moves', 'stock_move_lines', 'products',
        'account_journals', 'account_payments'
    ];
    
    for (const table of tablesToMigrate) {
        await addColumnIfMissing(table, 'sync_status', "TEXT DEFAULT 'synced'");
        await addColumnIfMissing(table, 'is_local', "INTEGER DEFAULT 0");
        if (table === 'sale_orders') {
            await addColumnIfMissing(table, 'invoice_id', "INTEGER");
        }
        if (table === 'account_moves') {
            await addColumnIfMissing(table, 'origin_order_id', "INTEGER");
            await addColumnIfMissing(table, 'move_type', "TEXT");
            await addColumnIfMissing(table, 'state', "TEXT");
            await addColumnIfMissing(table, 'payment_state', "TEXT");
        }
        if (table === 'account_move_lines') {
            await addColumnIfMissing(table, 'sale_line_id', "INTEGER");
        }
        if (table === 'stock_moves') {
            await addColumnIfMissing(table, 'picking_id', "INTEGER");
            await addColumnIfMissing(table, 'pending_delivery_qty', "REAL");
            await addColumnIfMissing(table, 'pending_delivery_date', "TEXT");
        }
        if (table === 'partners') {
            await addColumnIfMissing(table, 'vat', "TEXT");
            await addColumnIfMissing(table, 'street', "TEXT");
            await addColumnIfMissing(table, 'street2', "TEXT");
            await addColumnIfMissing(table, 'city', "TEXT");
            await addColumnIfMissing(table, 'zip', "TEXT");
            await addColumnIfMissing(table, 'credit', "REAL");
            await addColumnIfMissing(table, 'debit', "REAL");
            await addColumnIfMissing(table, 'credit_limit', "REAL");
            await addColumnIfMissing(table, 'total_due', "REAL");
            await addColumnIfMissing(table, 'total_overdue', "REAL");
            await addColumnIfMissing(table, 'comment', "TEXT");
            await addColumnIfMissing(table, 'x_studio_razon_social', "TEXT");
            await addColumnIfMissing(table, 'x_studio_complemento', "TEXT");
            await addColumnIfMissing(table, 'x_studio_giro', "TEXT");
            await addColumnIfMissing(table, 'x_studio_pago_a_proveedor', "TEXT");
            await addColumnIfMissing(table, 'x_studio_pago_de_cliente', "TEXT");
            await addColumnIfMissing(table, 'x_studio_tipo_de_documento', "TEXT");
            await addColumnIfMissing(table, 'image_128', "TEXT");
            await addColumnIfMissing(table, 'metadata', "TEXT");
        }
    }
    
    return db;
};

// --- CREATION HELPERS (OFFLINE) ---

export const createPartnerLocal = async (partner: any) => {
    const db = await getDb();
    const localId = -Math.floor(Date.now() / 1000); // Temporary negative ID
    await db.runAsync(
        `INSERT INTO partners (id, display_name, email, phone, sync_status, is_local) VALUES (?, ?, ?, ?, 'new', 1)`,
        [localId, partner.display_name, partner.email || '', partner.phone || '']
    );
    return localId;
};

export const updatePartnerLocal = async (partner: any) => {
    const db = await getDb();
    // Determine sync status: if already 'new' (local record), keep it. 
    // If it was 'synced', change to 'modified'.
    const current: any = await db.getFirstAsync(`SELECT sync_status FROM partners WHERE id = ?`, [partner.id]);
    const newSyncStatus = current?.sync_status === 'new' ? 'new' : 'modified';

    await db.runAsync(
        `UPDATE partners SET 
            display_name = ?, email = ?, phone = ?, vat = ?, 
            street = ?, city = ?, zip = ?, 
            x_studio_razon_social = ?, x_studio_complemento = ?, x_studio_giro = ?,
            x_studio_pago_a_proveedor = ?, x_studio_pago_de_cliente = ?, x_studio_tipo_de_documento = ?,
            sync_status = ? 
         WHERE id = ?`,
        [
            partner.display_name, partner.email || '', partner.phone || '', partner.vat || '',
            partner.street || '', partner.city || '', partner.zip || '',
            partner.x_studio_razon_social || '', partner.x_studio_complemento || '', partner.x_studio_giro || '',
            partner.x_studio_pago_a_proveedor || '', partner.x_studio_pago_de_cliente || '', partner.x_studio_tipo_de_documento || '',
            newSyncStatus, partner.id
        ]
    );
};

export const createSaleOrderLocal = async (order: any, lines: any[]) => {
    const db = await getDb();
    const localOrderId = -Math.floor(Date.now() / 1000);
    
    await db.runAsync(
        `INSERT INTO sale_orders (id, name, partner_name, date_order, state, amount_total, sync_status, is_local) VALUES (?, ?, ?, ?, ?, ?, 'new', 1)`,
        [localOrderId, `Local/${localOrderId}`, order.partner_name, order.date_order, 'draft', order.amount_total]
    );

    for (const l of lines) {
        const localLineId = -Math.floor(Math.random() * 1000000);
        await db.runAsync(
            `INSERT INTO sale_order_lines (id, order_id, product_id, product_name, product_uom_qty, price_unit, price_subtotal, sync_status, is_local) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 1)`,
            [localLineId, localOrderId, l.product_id, l.product_name, l.quantity, l.price, l.quantity * l.price]
        );
    }
    return localOrderId;
};

export const createInvoiceLocal = async (orderId: number) => {
    const db = await getDb();
    const order: any = await db.getFirstAsync('SELECT * FROM sale_orders WHERE id = ?', [orderId]);
    if (!order) throw new Error('Pedido no encontrado');

    const lines = await db.getAllAsync('SELECT * FROM sale_order_lines WHERE order_id = ?', [orderId]);
    
    const localInvoiceId = -Math.floor(Date.now() / 1000);
    
    await db.runAsync(
        `INSERT INTO account_moves (id, name, partner_name, move_type, state, payment_state, invoice_date, amount_total, amount_residual, origin_order_id, sync_status, is_local) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 1)`,
        [
            localInvoiceId, 
            `INV/Local/${localInvoiceId}`, 
            order.partner_name, 
            'out_invoice',
            'posted',
            'not_paid',
            new Date().toISOString().split('T')[0], 
            order.amount_total, 
            order.amount_total,
            orderId
        ]
    );

    for (const l of lines as any[]) {
        const localLineId = -Math.floor(Math.random() * 1000000);
        await db.runAsync(
            `INSERT INTO account_move_lines (id, move_id, product_name, quantity, price_unit, price_subtotal, sale_line_id, sync_status, is_local) 
             VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 1)`,
            [localLineId, localInvoiceId, l.product_name, l.product_uom_qty, l.price_unit, l.price_subtotal, l.id]
        );
    }

    // Link invoice to order
    await db.runAsync('UPDATE sale_orders SET invoice_id = ? WHERE id = ?', [localInvoiceId, orderId]);
    
    return localInvoiceId;
};

// Generic clear and insert helpers
export const clearTable = async (tableName: string) => {
    const db = await getDb();
    await db.runAsync(`DELETE FROM ${tableName}`);
};

// Partners
export const savePartners = async (partners: any[]) => {
    const db = await getDb();
    for (const p of partners) {
        await db.runAsync(
            `INSERT OR REPLACE INTO partners (
                id, display_name, email, phone, lang, 
                vat, street, street2, city, zip, 
                credit, debit, credit_limit, total_due, total_overdue, 
                comment, x_studio_razon_social, 
                x_studio_complemento, x_studio_giro, x_studio_pago_a_proveedor, 
                x_studio_pago_de_cliente, x_studio_tipo_de_documento,
                image_128, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                p.id || 0,
                p.display_name || '',
                p.email || '',
                p.phone || '',
                p.lang || '',
                p.vat || '',
                p.street || '',
                p.street2 || '',
                p.city || '',
                p.zip || '',
                p.credit || 0,
                p.debit || 0,
                p.credit_limit || 0,
                p.total_due || 0,
                p.total_overdue || 0,
                p.comment || '',
                p.x_studio_razon_social || '',
                p.x_studio_complemento || '',
                p.x_studio_giro || '',
                p.x_studio_pago_a_proveedor || '',
                p.x_studio_pago_de_cliente || '',
                p.x_studio_tipo_de_documento || '',
                p.image_128 || '',
                p.id ? JSON.stringify(p) : ''
            ]
        );
    }
};

export const getPartners = async () => {
    const db = await getDb();
    return await db.getAllAsync('SELECT * FROM partners');
};

export const searchPartners = async (query: string) => {
    const db = await getDb();
    return await db.getAllAsync(
        'SELECT id, display_name FROM partners WHERE display_name LIKE ? LIMIT 5',
        [`%${query}%`]
    );
};

// Sale Orders
export const saveSaleOrders = async (orders: any[]) => {
    const db = await getDb();
    for (const o of orders) {
        await db.runAsync(
            `INSERT OR REPLACE INTO sale_orders (id, name, display_name, partner_name, date_order, state, amount_total, invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                o.id || 0,
                o.name || '',
                o.display_name || '',
                Array.isArray(o.partner_id) ? o.partner_id[1] : '',
                o.date_order || '',
                o.state || '',
                o.amount_total || 0,
                Array.isArray(o.invoice_ids) && o.invoice_ids.length > 0 ? o.invoice_ids[0] : null
            ]
        );
        
        if (o.lines_data) {
            for (const l of o.lines_data) {
                await db.runAsync(
                    `INSERT OR REPLACE INTO sale_order_lines (id, order_id, product_id, product_name, product_uom_qty, price_unit, price_subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        l.id || 0,
                        o.id || 0,
                        Array.isArray(l.product_id) ? l.product_id[0] : 0,
                        Array.isArray(l.product_id) ? l.product_id[1] : '',
                        l.product_uom_qty || 0,
                        l.price_unit || 0,
                        l.price_subtotal || 0
                    ]
                );
            }
        }
    }
};

export const getSaleOrders = async () => {
    const db = await getDb();
    const orders: any[] = await db.getAllAsync('SELECT * FROM sale_orders');
    for (const o of orders) {
        o.lines_data = await db.getAllAsync('SELECT * FROM sale_order_lines WHERE order_id = ?', [o.id]);
        // Normalize fields to match Odoo response structure for UI compatibility
        o.partner_id = [0, o.partner_name];
        for (const l of o.lines_data) {
            l.product_id = [l.product_id, l.product_name];
        }
    }
    return orders;
};

// Account Moves (Cobranzas)
export const saveAccountMoves = async (moves: any[]) => {
    const db = await getDb();
    for (const m of moves) {
        await db.runAsync(
            `INSERT OR REPLACE INTO account_moves (id, name, partner_name, move_type, state, payment_state, invoice_date, invoice_date_due, amount_total, amount_residual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                m.id || 0,
                m.name || '',
                Array.isArray(m.partner_id) ? m.partner_id[1] : '',
                m.move_type || '',
                m.state || '',
                m.payment_state || '',
                m.invoice_date || '',
                m.invoice_date_due || '',
                m.amount_total || 0,
                m.amount_residual || 0
            ]
        );
        
        if (m.lines) {
            for (const l of m.lines) {
                await db.runAsync(
                    `INSERT OR REPLACE INTO account_move_lines (id, move_id, product_name, quantity, price_unit, price_subtotal, debit, credit, uom_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        l.id || 0,
                        m.id || 0,
                        l.product_id ? (Array.isArray(l.product_id) ? l.product_id[1] : l.product_id) : (l.name || ''),
                        l.quantity || 0,
                        l.price_unit || 0,
                        l.price_subtotal || 0,
                        l.debit || 0,
                        l.credit || 0,
                        Array.isArray(l.product_uom_id) ? l.product_uom_id[1] : ''
                    ]
                );
            }
        }
    }
};

export const getAccountMoves = async (options?: { pendingOnly?: boolean }) => {
    const db = await getDb();
    const pendingOnly = options?.pendingOnly ?? false;
    const moves: any[] = pendingOnly
        ? await db.getAllAsync(
            `SELECT * FROM account_moves
             WHERE move_type = 'out_invoice'
             AND state = 'posted'
             AND payment_state IN ('not_paid', 'partial')`
        )
        : await db.getAllAsync('SELECT * FROM account_moves');
    for (const m of moves) {
        m.lines = await db.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [m.id]);
        m.partner_id = [0, m.partner_name];
        for (const l of m.lines) {
            l.product_id = [0, l.product_name];
            l.product_uom_id = [0, l.uom_name];
        }
    }
    return moves;
};

// Stock Moves (Distribucion)
export const saveStockMoves = async (moves: any[]) => {
    const db = await getDb();
    for (const m of moves) {
        await db.runAsync(
            `INSERT OR REPLACE INTO stock_moves (id, picking_id, reference, product_name, product_uom_qty, uom_name, state, origin, partner_name, date, date_deadline, pending_delivery_qty, pending_delivery_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                m.id || 0,
                Array.isArray(m.picking_id) ? m.picking_id[0] : (m.picking_id || null),
                m.reference || '',
                Array.isArray(m.product_id) ? m.product_id[1] : '',
                m.product_uom_qty || 0,
                Array.isArray(m.product_uom) ? m.product_uom[1] : '',
                m.state || '',
                m.origin || '',
                Array.isArray(m.partner_id) ? m.partner_id[1] : '',
                m.date || '',
                m.date_deadline || '',
                null,
                null
            ]
        );
        
        if (m.lines) {
            for (const l of m.lines) {
                await db.runAsync(
                    `INSERT OR REPLACE INTO stock_move_lines (id, move_id, product_name, quantity, uom_name, lot_name, location_name, location_dest_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        l.id || 0,
                        m.id || 0,
                        Array.isArray(l.product_id) ? l.product_id[1] : '',
                        l.quantity || 0,
                        Array.isArray(l.product_uom_id) ? l.product_uom_id[1] : '',
                        Array.isArray(l.lot_id) ? l.lot_id[1] : '',
                        Array.isArray(l.location_id) ? l.location_id[1] : '',
                        Array.isArray(l.location_dest_id) ? l.location_dest_id[1] : ''
                    ]
                );
            }
        }
    }
};

export const getStockMoves = async () => {
    const db = await getDb();
    const moves: any[] = await db.getAllAsync('SELECT * FROM stock_moves');
    for (const m of moves) {
        m.lines = await db.getAllAsync('SELECT * FROM stock_move_lines WHERE move_id = ?', [m.id]);
        m.product_id = [0, m.product_name];
        m.product_uom = [0, m.uom_name];
        m.partner_id = [0, m.partner_name];
        for (const l of m.lines) {
            l.product_id = [0, l.product_name];
            l.product_uom_id = [0, l.uom_name];
            l.lot_id = l.lot_name ? [0, l.lot_name] : false;
            l.location_id = [0, l.location_name];
            l.location_dest_id = [0, l.location_dest_name];
        }
    }
    return moves;
};

export const queueStockMoveDelivery = async (moveId: number, pickingId: number, deliveredQty: number) => {
    const db = await getDb();
    await db.runAsync(
        `UPDATE stock_moves
         SET picking_id = ?, pending_delivery_qty = ?, pending_delivery_date = ?, sync_status = 'modified', is_local = 1
         WHERE id = ?`,
        [pickingId, deliveredQty, new Date().toISOString(), moveId]
    );
};

export const clearPendingStockMoveDelivery = async (moveId: number) => {
    const db = await getDb();
    await db.runAsync(
        `UPDATE stock_moves
         SET pending_delivery_qty = NULL, pending_delivery_date = NULL, sync_status = 'synced', is_local = 0
         WHERE id = ?`,
        [moveId]
    );
};

// Products
export const saveProducts = async (products: any[]) => {
    const db = await getDb();
    for (const p of products) {
        await db.runAsync(
            `INSERT OR REPLACE INTO products (id, display_name, list_price) VALUES (?, ?, ?)`,
            [p.id, p.display_name, p.list_price || 0]
        );
    }
};

export const searchProducts = async (query: string) => {
    const db = await getDb();
    return await db.getAllAsync(
        'SELECT id, display_name, list_price FROM products WHERE display_name LIKE ? LIMIT 5',
        [`%${query}%`]
    );
};

// Journals
export const saveJournals = async (journals: any[]) => {
    const db = await getDb();
    for (const j of journals) {
        await db.runAsync(
            `INSERT OR REPLACE INTO account_journals (id, name, type) VALUES (?, ?, ?)`,
            [j.id, j.name, j.type]
        );
    }
};

export const getJournals = async () => {
    const db = await getDb();
    return await db.getAllAsync('SELECT * FROM account_journals');
};

// Payments
export const saveLocalPayment = async (payment: any) => {
    const db = await getDb();
    const localId = payment.id || -Math.floor(Date.now() / 1000);
    const syncStatus = payment.sync_status || 'new';
    const isLocal = syncStatus === 'synced' ? 0 : 1;

    await db.runAsync(
        `INSERT INTO account_payments (id, amount, payment_date, journal_id, partner_id, invoice_id, memo, sync_status, is_local) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            localId,
            payment.amount,
            payment.payment_date || new Date().toISOString().split('T')[0],
            payment.journal_id,
            payment.partner_id,
            payment.invoice_id,
            payment.memo || '',
            syncStatus,
            isLocal
        ]
    );

    // Update local invoice residual
    await db.runAsync(
        'UPDATE account_moves SET amount_residual = amount_residual - ? WHERE id = ?',
        [payment.amount, payment.invoice_id]
    );
    
    return localId;
};

// --- SYNC HELPERS ---

export const getUnsyncedRecords = async (tableName: string) => {
    const db = await getDb();
    return await db.getAllAsync(`SELECT * FROM ${tableName} WHERE sync_status != 'synced'`);
};

export const markSynced = async (tableName: string, id: number, newId?: number) => {
    const db = await getDb();
    if (newId) {
        await db.runAsync(`UPDATE ${tableName} SET sync_status = 'synced', id = ?, is_local = 0 WHERE id = ?`, [newId, id]);
    } else {
        await db.runAsync(`UPDATE ${tableName} SET sync_status = 'synced' WHERE id = ?`, [id]);
    }
};

export const getSaleOrderLines = async (orderId: number) => {
    const db = await getDb();
    return await db.getAllAsync(`SELECT * FROM sale_order_lines WHERE order_id = ?`, [orderId]);
};

export const deleteLocalDatabase = async () => {
    const db = await getDb();
    // Drop logic or just delete all records
    const tables = [
        'partners', 'sale_orders', 'sale_order_lines', 
        'account_moves', 'account_move_lines', 
        'stock_moves', 'stock_move_lines', 'products',
        'account_journals', 'account_payments'
    ];
    for (const t of tables) {
        await db.runAsync(`DELETE FROM ${t}`);
    }
};
