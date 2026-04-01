import * as SQLite from 'expo-sqlite';

const DB_NAME = 'odoo_siat_v2.db';
let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Singleton-like getter for the database connection.
 * Ensures openDatabaseAsync is only called once and returns the same instance.
 */
let initPromise: Promise<void> | null = null;

export const getDb = async () => {
    if (dbInstance) return dbInstance;
    if (dbPromise) return dbPromise;

    dbPromise = (async () => {
        const db = await SQLite.openDatabaseAsync(DB_NAME);
        dbInstance = db;
        dbPromise = null;
        return db;
    })();

    return dbPromise;
};

export const initDB = async () => {
    if (initPromise) return initPromise;

    initPromise = (async () => {
        console.log('Initializing SQLite database (v2)...');
        const db = await getDb();
        await db.runAsync('PRAGMA journal_mode = WAL');

        // SOLUCIÓN DE EMERGENCIA: Si falta company_id en partners, borramos para recrear limpio
        try {
            const tableInfo: any[] = await db.getAllAsync('PRAGMA table_info(partners)');
            const hasCompany = tableInfo.some(col => col.name === 'company_id');
            if (tableInfo.length > 0 && !hasCompany) {
                console.log('Filtro crítico faltante. Reconstruyendo base de datos...');
                await db.runAsync('DROP TABLE IF EXISTS partners');
                await db.runAsync('DROP TABLE IF EXISTS sale_orders');
                await db.runAsync('DROP TABLE IF EXISTS account_moves');
            }
            
            // Migración incremental para responsables
            const saleOrderInfo: any[] = await db.getAllAsync('PRAGMA table_info(sale_orders)');
            if (saleOrderInfo.length > 0 && !saleOrderInfo.some(col => col.name === 'user_name')) {
                console.log('Añadiendo columna user_name a sale_orders...');
                await db.runAsync('ALTER TABLE sale_orders ADD COLUMN user_name TEXT');
            }
            const accMoveInfo: any[] = await db.getAllAsync('PRAGMA table_info(account_moves)');
            if (accMoveInfo.length > 0 && !accMoveInfo.some(col => col.name === 'invoice_user_name')) {
                console.log('Añadiendo columna invoice_user_name a account_moves...');
                await db.runAsync('ALTER TABLE account_moves ADD COLUMN invoice_user_name TEXT');
            }
            if (tableInfo.length > 0 && !tableInfo.some(col => col.name === 'mobile')) {
                console.log('Añadiendo columna mobile a partners...');
                await db.runAsync('ALTER TABLE partners ADD COLUMN mobile TEXT');
            }
            const stockMoveInfo: any[] = await db.getAllAsync('PRAGMA table_info(stock_moves)');
            if (stockMoveInfo.length > 0 && !stockMoveInfo.some(col => col.name === 'user_name')) {
                console.log('Añadiendo columna user_name a stock_moves...');
                await db.runAsync('ALTER TABLE stock_moves ADD COLUMN user_name TEXT');
            }
        } catch (e) {
            console.warn('Check de esquema fallido:', e);
        }

        const createTables: string[] = [];
        
        createTables.push(`CREATE TABLE IF NOT EXISTS partners (
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
            x_studio_complemento TEXT,
            x_studio_giro TEXT,
            x_studio_pago_a_proveedor TEXT,
            x_studio_pago_de_cliente TEXT,
            x_studio_tipo_de_documento TEXT,
            mobile TEXT,
            image_128 TEXT,
            company_id INTEGER,
            user_id INTEGER,
            partner_latitude REAL,
            partner_longitude REAL,
            metadata TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS sale_orders (
            id INTEGER PRIMARY KEY,
            name TEXT,
            display_name TEXT,
            partner_name TEXT,
            partner_id INTEGER,
            date_order TEXT,
            state TEXT,
            amount_total REAL,
            invoice_id INTEGER,
            company_id INTEGER,
            user_id INTEGER,
            user_name TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS sale_order_lines (
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
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS account_moves (
            id INTEGER PRIMARY KEY,
            name TEXT,
            partner_id INTEGER,
            partner_name TEXT,
            move_type TEXT,
            state TEXT,
            payment_state TEXT,
            invoice_date TEXT,
            invoice_date_due TEXT,
            amount_total REAL,
            amount_residual REAL,
            invoice_user_id INTEGER,
            invoice_user_name TEXT,
            company_id INTEGER,
            origin_order_id INTEGER,
            siat_status TEXT DEFAULT 'not_sent',
            siat_url TEXT,
            siat_qr_content TEXT,
            siat_cuf TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS account_move_lines (
            id INTEGER PRIMARY KEY,
            move_id INTEGER,
            product_id INTEGER,
            product_name TEXT,
            quantity REAL,
            price_unit REAL,
            price_subtotal REAL,
            debit REAL,
            credit REAL,
            date_maturity TEXT,
            uom_name TEXT,
            sale_line_id INTEGER,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0,
            FOREIGN KEY(move_id) REFERENCES account_moves(id)
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS stock_moves (
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
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS stock_move_lines (
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
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY,
            display_name TEXT,
            list_price REAL,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS account_journals (
            id INTEGER PRIMARY KEY,
            name TEXT,
            type TEXT,
            sync_status TEXT DEFAULT 'synced'
        )`);

        createTables.push(`CREATE TABLE IF NOT EXISTS account_payments (
            id INTEGER PRIMARY KEY,
            amount REAL,
            payment_date TEXT,
            journal_id INTEGER,
            partner_id INTEGER,
            invoice_id INTEGER,
            memo TEXT,
            sync_status TEXT DEFAULT 'synced',
            is_local INTEGER DEFAULT 0
        )`);

        for (const sql of createTables) {
            try {
                await db.runAsync(sql);
            } catch (e) {
                console.error(`Error creating table with SQL: ${sql}`, e);
                throw e;
            }
        }

        // 2. Migration logic
        const addColumnIfMissing = async (tableName: string, columnName: string, columnDef: string) => {
            try {
                const tableInfo: any[] = await db.getAllAsync(`PRAGMA table_info(${tableName})`);
                const hasColumn = tableInfo.some(col => col.name === columnName);
                if (!hasColumn) {
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
            
            if (['partners', 'sale_orders', 'account_moves', 'stock_moves', 'account_payments'].includes(table)) {
                await addColumnIfMissing(table, 'company_id', "INTEGER");
                if (table === 'account_moves') {
                    await addColumnIfMissing(table, 'invoice_user_id', "INTEGER");
                } else {
                    await addColumnIfMissing(table, 'user_id', "INTEGER");
                }
            }

            if (table === 'sale_orders' || table === 'stock_moves') {
                await addColumnIfMissing(table, 'partner_id', "INTEGER");
                if (table === 'sale_orders') {
                    await addColumnIfMissing(table, 'invoice_id', "INTEGER");
                }
            }
            if (table === 'account_moves') {
                await addColumnIfMissing(table, 'partner_id', "INTEGER");
                await addColumnIfMissing(table, 'origin_order_id', "INTEGER");
                await addColumnIfMissing(table, 'move_type', "TEXT");
                await addColumnIfMissing(table, 'state', "TEXT");
                await addColumnIfMissing(table, 'payment_state', "TEXT");
                await addColumnIfMissing(table, 'siat_status', "TEXT DEFAULT 'not_sent'");
                await addColumnIfMissing(table, 'siat_url', "TEXT");
                await addColumnIfMissing(table, 'siat_qr_content', "TEXT");
                await addColumnIfMissing(table, 'siat_cuf', "TEXT");
            }
            if (table === 'account_move_lines') {
                await addColumnIfMissing(table, 'product_id', "INTEGER");
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
                await addColumnIfMissing(table, 'lang', "TEXT");
                await addColumnIfMissing(table, 'comment', "TEXT");
                await addColumnIfMissing(table, 'x_studio_razon_social', "TEXT");
                await addColumnIfMissing(table, 'x_studio_complemento', "TEXT");
                await addColumnIfMissing(table, 'x_studio_giro', "TEXT");
                await addColumnIfMissing(table, 'x_studio_pago_a_proveedor', "TEXT");
                await addColumnIfMissing(table, 'x_studio_pago_de_cliente', "TEXT");
                await addColumnIfMissing(table, 'x_studio_tipo_de_documento', "TEXT");
                await addColumnIfMissing(table, 'image_128', "TEXT");
                await addColumnIfMissing(table, 'metadata', "TEXT");
                await addColumnIfMissing(table, 'partner_latitude', "REAL");
                await addColumnIfMissing(table, 'partner_longitude', "REAL");
            }
        }
    })();
    return initPromise;
};

// --- CREATION HELPERS (OFFLINE) ---

export const createPartnerLocal = async (partner: any) => {
    const db = await getDb();
    const localId = -Math.floor(Date.now() / 1000); // Temporary negative ID
    await db.runAsync(
        `INSERT INTO partners (id, display_name, email, phone, sync_status, is_local, partner_latitude, partner_longitude) VALUES (?, ?, ?, ?, 'new', 1, ?, ?)`,
        [localId, partner.display_name, partner.email || '', partner.phone || '', partner.partner_latitude || 0, partner.partner_longitude || 0]
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
            partner_latitude = ?, partner_longitude = ?,
            sync_status = ? 
         WHERE id = ?`,
        [
            partner.display_name, partner.email || '', partner.phone || '', partner.vat || '',
            partner.street || '', partner.city || '', partner.zip || '',
            partner.x_studio_razon_social || '', partner.x_studio_complemento || '', partner.x_studio_giro || '',
            partner.x_studio_pago_a_proveedor || '', partner.x_studio_pago_de_cliente || '', partner.x_studio_tipo_de_documento || '',
            partner.partner_latitude || 0, partner.partner_longitude || 0,
            newSyncStatus, partner.id
        ]
    );
};

export const createSaleOrderLocal = async (order: any, lines: any[]) => {
    console.log('[DEBUG] createSaleOrderLocal called with:', JSON.stringify(order), lines.length, 'lines');
    const db = await getDb();
    
    // Si ya viene con ID real (RealTime), lo usamos. Si no, generamos uno local negativo.
    const isRealTime = order.id && order.id > 0;
    const orderId = isRealTime ? order.id : -Math.floor(Date.now() / 1000);
    const syncStatus = order.sync_status || 'new';
    const isLocal = syncStatus === 'synced' ? 0 : 1;
    
    try {
        console.log('[DEBUG] Inserting sale_order with ID:', orderId, 'Status:', syncStatus);
        await db.runAsync(
            `INSERT INTO sale_orders (id, name, partner_name, partner_id, date_order, state, amount_total, sync_status, is_local, user_id, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [orderId, order.name || `Local/${orderId}`, order.partner_name, order.partner_id || null, order.date_order, order.state || 'draft', order.amount_total, syncStatus, isLocal, order.user_id, order.user_name]
        );

        for (const l of lines) {
            const localLineId = -Math.floor(Math.random() * 1000000);
            await db.runAsync(
                `INSERT INTO sale_order_lines (id, order_id, product_id, product_name, product_uom_qty, price_unit, price_subtotal, sync_status, is_local) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [localLineId, orderId, l.product_id, l.product_name, l.quantity, l.price, l.quantity * l.price, syncStatus, isLocal]
            );
        }
        console.log('[DEBUG] Sale order saved locally with success.');
    } catch (e: any) {
        console.error('[ERROR] Failed to save sale order locally:', e.message, e);
        throw e;
    }
};

export const setInvoiceSiatStatusLocal = async (invoiceId: number, status: string) => {
    await initDB();
    const db = await getDb();
    await db.runAsync(
        'UPDATE account_moves SET siat_status = ?, sync_status = "modified", is_local = 1 WHERE id = ?',
        [status, invoiceId]
    );
};

export const createInvoiceLocal = async (orderId: number, userId: number | null = null, userName: string | null = null, forceId: number | null = null, forceStatus: string = 'new') => {
    await initDB();
    const db = await getDb();
    console.log('[DEBUG] createInvoiceLocal called for orderId:', orderId, 'Status:', forceStatus);
    
    try {
        const order: any = await db.getFirstAsync('SELECT * FROM sale_orders WHERE id = ?', [orderId]);
        if (!order) throw new Error('Order not found');

        const lines: any[] = await db.getAllAsync('SELECT * FROM sale_order_lines WHERE order_id = ?', [orderId]);
        
        const invoiceId = forceId || -Math.floor(Date.now() / 1000);
        const isLocal = forceStatus === 'synced' ? 0 : 1;

        await db.execAsync('BEGIN TRANSACTION');
        
        await db.runAsync(
            `INSERT INTO account_moves (id, name, partner_id, partner_name, move_type, state, payment_state, invoice_date, amount_total, amount_residual, invoice_user_id, invoice_user_name, sync_status, is_local, origin_order_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                invoiceId, 
                order.name || `Local/INV/${invoiceId}`, 
                order.partner_id, 
                order.partner_name, 
                'out_invoice', 
                'posted', 
                'not_paid', 
                order.date_order, 
                order.amount_total, 
                order.amount_total,
                userId, 
                userName, 
                forceStatus, 
                isLocal, 
                orderId
            ]
        );

        for (const l of lines) {
            const lineId = -Math.floor(Math.random() * 1000000);
            await db.runAsync(
                `INSERT INTO account_move_lines (id, move_id, product_id, product_name, quantity, price_unit, price_subtotal, sync_status, is_local)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    lineId, 
                    invoiceId, 
                    l.product_id, 
                    l.product_name, 
                    l.product_uom_qty || l.quantity || 0, 
                    l.price_unit || l.price || 0, 
                    l.price_subtotal || 0, 
                    forceStatus, 
                    isLocal
                ]
            );
        }

        await db.runAsync('UPDATE sale_orders SET invoice_id = ?, sync_status = "modified" WHERE id = ?', [invoiceId, orderId]);
        await db.execAsync('COMMIT');
        
        return invoiceId;
    } catch (e: any) {
        await db.execAsync('ROLLBACK');
        console.error('Failed to generate local invoice:', e.message);
        throw e;
    }
};

// --- SYNC / SEARCH HELPERS ---

export const clearTable = async (tableName: string) => {
    const db = await getDb();
    await db.runAsync(`DELETE FROM ${tableName}`);
};

export const savePartners = async (partners: any[]) => {
    await initDB();
    const db = await getDb();
    await db.execAsync('BEGIN TRANSACTION');
    try {
        for (const p of partners) {
            await db.runAsync(
                `INSERT OR REPLACE INTO partners (
                    id, display_name, email, phone, lang, 
                    vat, street, street2, city, zip, 
                    credit, debit, credit_limit, total_due, total_overdue, 
                    comment, x_studio_razon_social, 
                    x_studio_complemento, x_studio_giro, x_studio_pago_a_proveedor, 
                    x_studio_pago_de_cliente, x_studio_tipo_de_documento,
                    image_128, company_id, user_id, partner_latitude, partner_longitude, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    Array.isArray(p.company_id) ? p.company_id[0] : (p.company_id || 0),
                    Array.isArray(p.user_id) ? p.user_id[0] : (p.user_id || 0),
                    p.partner_latitude || 0,
                    p.partner_longitude || 0,
                    p.id ? JSON.stringify(p) : ''
                ]
            );
        }
        await db.execAsync('COMMIT');
        console.log(`[SQLITE] Éxito: ${partners.length} clientes guardados.`);
    } catch (e) {
        await db.execAsync('ROLLBACK');
        console.error('Error guardando partners:', e);
        throw e;
    }
};

export const getPartners = async () => {
    await initDB();
    const db = await getDb();
    return await db.getAllAsync('SELECT * FROM partners');
};

export const searchPartners = async (query: string) => {
    await initDB();
    const db = await getDb();
    return await db.getAllAsync(
        'SELECT id, display_name FROM partners WHERE display_name LIKE ? LIMIT 5',
        [`%${query}%`]
    );
};

// Sale Orders
export const saveSaleOrders = async (orders: any[]) => {
    await initDB();
    const db = await getDb();
    const extractId = (val: any) => Array.isArray(val) ? val[0] : (val || 0);
    const extractName = (val: any) => Array.isArray(val) ? val[1] : (val || '');

    await db.execAsync('BEGIN TRANSACTION');
    try {
        for (const o of orders) {
            await db.runAsync(
                `INSERT OR REPLACE INTO sale_orders (id, name, display_name, partner_id, partner_name, date_order, state, amount_total, invoice_id, company_id, user_id, user_name) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    o.id || 0,
                    o.name || '',
                    o.display_name || '',
                    extractId(o.partner_id),
                    extractName(o.partner_id),
                    o.date_order || '',
                    o.state || '',
                    o.amount_total || 0,
                    Array.isArray(o.invoice_ids) && o.invoice_ids.length > 0 ? o.invoice_ids[0] : null,
                    Array.isArray(o.company_id) ? o.company_id[0] : (o.company_id || 0),
                    extractId(o.user_id),
                    extractName(o.user_id)
                ]
            );
            
            if (o.lines_data) {
                for (const l of o.lines_data) {
                    await db.runAsync(
                        `INSERT OR REPLACE INTO sale_order_lines (id, order_id, product_id, product_name, product_uom_qty, price_unit, price_subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            l.id || 0,
                            o.id,
                            extractId(l.product_id),
                            extractName(l.product_id),
                            l.product_uom_qty || 0,
                            l.price_unit || 0,
                            l.price_subtotal || 0
                        ]
                    );
                }
            }
        }
        await db.execAsync('COMMIT');
        console.log(`[SQLITE] Éxito: ${orders.length} pedidos de venta guardados.`);
    } catch (e) {
        await db.execAsync('ROLLBACK');
        console.error('Error guardando sale_orders:', e);
        throw e;
    }
};

export const getSaleOrders = async () => {
    await initDB();
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

export const confirmSaleOrderLocal = async (orderId: number) => {
    await initDB();
    const db = await getDb();
    await db.runAsync(
        'UPDATE sale_orders SET state = "sale", sync_status = "modified", is_local = 1 WHERE id = ?',
        [orderId]
    );
};

// Account Moves (Cobranzas)
export const saveAccountMoves = async (moves: any[]) => {
    await initDB();
    const db = await getDb();
    const extractId = (val: any) => Array.isArray(val) ? val[0] : (val || 0);
    const extractName = (val: any) => Array.isArray(val) ? val[1] : (val || '');

    await db.execAsync('BEGIN TRANSACTION');
    try {
        for (const m of moves) {
            await db.runAsync(
                `INSERT OR REPLACE INTO account_moves (id, name, partner_id, partner_name, move_type, state, payment_state, invoice_date, invoice_date_due, amount_total, amount_residual, invoice_user_id, invoice_user_name, company_id, siat_status, siat_url, siat_qr_content, siat_cuf, sync_status) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')`,
                [
                    m.id || 0,
                    m.name || '',
                    extractId(m.partner_id),
                    extractName(m.partner_id),
                    m.move_type || '',
                    m.state || '',
                    m.payment_state || '',
                    m.invoice_date || '',
                    m.invoice_date_due || '',
                    m.amount_total || 0,
                    m.amount_residual || 0,
                    extractId(m.invoice_user_id),
                    extractName(m.invoice_user_id),
                    m.company_id ? extractId(m.company_id) : 0,
                    m.siat_estado || 'no_enviado',
                    m.siat_qr_string || '',
                    m.siat_qr_image || '',
                    m.siat_cuf || ''
                ]
            );
            
            if (m.lines) {
                for (const l of m.lines) {
                    await db.runAsync(
                        `INSERT OR REPLACE INTO account_move_lines (id, move_id, product_name, quantity, price_unit, price_subtotal, debit, credit, date_maturity, uom_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            l.id || 0,
                            m.id || 0,
                            l.product_id ? (Array.isArray(l.product_id) ? l.product_id[1] : l.product_id) : (l.name || ''),
                            l.quantity || 0,
                            l.price_unit || 0,
                            l.price_subtotal || 0,
                            l.debit || 0,
                            l.credit || 0,
                            l.date_maturity || '',
                            Array.isArray(l.product_uom_id) ? l.product_uom_id[1] : ''
                        ]
                    );
                }
            }
        }
        await db.execAsync('COMMIT');
        console.log(`[SQLITE] Éxito: ${moves.length} facturas guardadas.`);
    } catch (e) {
        await db.execAsync('ROLLBACK');
        console.error('Error guardando account_moves:', e);
        throw e;
    }
};

export const getAccountMoves = async () => {
    await initDB();
    const db = await getDb();
    // Traemos todos los movimientos locales (el filtrado por usuario ya se hizo al descargar)
    const moves: any[] = await db.getAllAsync(
        `SELECT * FROM account_moves 
         WHERE move_type = 'out_invoice' 
         ORDER BY invoice_date DESC`
    );
    
    for (const m of moves) {
        m.lines = await db.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [m.id]);
        m.partner_id = [m.partner_id || 0, m.partner_name || ''];
        // Normalizar responsable para la UI
        m.invoice_user_id = [m.invoice_user_id || 0, m.invoice_user_name || ''];
        for (const l of m.lines) {
            l.product_id = [0, l.product_name || ''];
            l.product_uom_id = [0, l.uom_name || ''];
        }
    }
    return moves;
};

export const getAccountMoveLines = async (moveId: number) => {
    await initDB();
    const db = await getDb();
    const rows: any[] = await db.getAllAsync('SELECT * FROM account_move_lines WHERE move_id = ?', [moveId]);
    return rows.map(r => ({
        ...r,
        product_id: [0, r.product_name || ''],
        product_uom_id: [0, r.uom_name || '']
    }));
};


// Stock Moves (Distribucion)
export const saveStockMoves = async (moves: any[]) => {
    await initDB();
    const db = await getDb();
    const extractId = (val: any) => Array.isArray(val) ? val[0] : (val || 0);

    await db.execAsync('BEGIN TRANSACTION');
    try {
        for (const m of moves) {
            await db.runAsync(
                `INSERT OR REPLACE INTO stock_moves (id, picking_id, reference, product_name, product_uom_qty, uom_name, state, origin, partner_id, partner_name, date, date_deadline, pending_delivery_qty, pending_delivery_date, company_id, user_id, user_name) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    m.id || 0,
                    extractId(m.picking_id),
                    m.reference || '',
                    Array.isArray(m.product_id) ? m.product_id[1] : '',
                    m.product_uom_qty || 0,
                    Array.isArray(m.product_uom) ? m.product_uom[1] : '',
                    m.state || '',
                    m.origin || '',
                    extractId(m.partner_id),
                    Array.isArray(m.partner_id) ? m.partner_id[1] : '',
                    m.date || '',
                    m.date_deadline || '',
                    null,
                    null,
                    m.company_id ? extractId(m.company_id) : 0,
                    m.user_id ? (Array.isArray(m.user_id) ? m.user_id[0] : m.user_id) : 0,
                    m.user_name || (Array.isArray(m.user_id) ? m.user_id[1] : '')
                ]
            );

            if (m.line_ids && Array.isArray(m.line_ids)) {
                // Si Odoo devuelve líneas detalladas, las guardamos
                for (const l of m.line_ids) {
                    await db.runAsync(
                        `INSERT OR REPLACE INTO stock_move_lines (id, move_id, product_name, quantity, uom_name) VALUES (?, ?, ?, ?, ?)`,
                        [
                            typeof l === 'number' ? l : l.id,
                            m.id,
                            Array.isArray(l.product_id) ? l.product_id[1] : '',
                            l.quantity || 0,
                            Array.isArray(l.product_uom_id) ? l.product_uom_id[1] : ''
                        ]
                    );
                }
            }
        }
        await db.execAsync('COMMIT');
        console.log(`[SQLITE] Éxito: ${moves.length} movimientos de stock guardados.`);
    } catch (e) {
        await db.execAsync('ROLLBACK');
        console.error('Error guardando stock_moves:', e);
        throw e;
    }
};

export const getStockMoves = async () => {
    await initDB();
    const db = await getDb();
    const moves: any[] = await db.getAllAsync('SELECT * FROM stock_moves');
    for (const m of moves) {
        m.lines = await db.getAllAsync('SELECT * FROM stock_move_lines WHERE move_id = ?', [m.id]);
        m.product_id = [0, m.product_name];
        m.product_uom = [0, m.uom_name];
        m.partner_id = m.partner_id ? [m.partner_id, m.partner_name] : [0, m.partner_name];
        // Enforce user_name availability for UI
        if (!m.user_name && m.user_id) m.user_name = `Responsable ID: ${m.user_id}`;
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

export const getStockMovesWithCoords = async () => {
    await initDB();
    const db = await getDb();
    const query = `
        SELECT sm.*, p.partner_latitude, p.partner_longitude
        FROM stock_moves sm
        LEFT JOIN partners p ON sm.partner_id = p.id
        WHERE sm.state NOT IN ('done', 'cancel')
    `;
    const rows: any[] = await db.getAllAsync(query);
    return rows.map(m => ({
        ...m,
        picking_id: m.picking_id ? [m.picking_id, m.reference] : false,
        partner_id: m.partner_id ? [m.partner_id, m.partner_name] : [0, m.partner_name],
        latitude: m.partner_latitude,
        longitude: m.partner_longitude
    }));
};

export const queueStockMoveDelivery = async (moveId: number, pickingId: number, deliveredQty: number) => {
    await initDB();
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
    await initDB();
    const db = await getDb();
    await db.execAsync('BEGIN TRANSACTION');
    try {
        for (const p of products) {
            await db.runAsync(
                `INSERT OR REPLACE INTO products (id, display_name, list_price) VALUES (?, ?, ?)`,
                [p.id, p.display_name, p.list_price || 0]
            );
        }
        await db.execAsync('COMMIT');
    } catch (e) {
        await db.execAsync('ROLLBACK');
        console.error('Error guardando productos:', e);
    }
};

export const getProducts = async () => {
    await initDB();
    const db = await getDb();
    return await db.getAllAsync('SELECT * FROM products');
};

export const searchProducts = async (query: string) => {
    await initDB();
    const db = await getDb();
    return await db.getAllAsync(
        'SELECT id, display_name, list_price FROM products WHERE display_name LIKE ? LIMIT 5',
        [`%${query}%`]
    );
};

// Journals
export const saveJournals = async (journals: any[]) => {
    await initDB();
    const db = await getDb();
    await db.execAsync('BEGIN TRANSACTION');
    try {
        for (const j of journals) {
            await db.runAsync(
                `INSERT OR REPLACE INTO account_journals (id, name, type) VALUES (?, ?, ?)`,
                [j.id, j.name, j.type]
            );
        }
        await db.execAsync('COMMIT');
    } catch (e) {
        await db.execAsync('ROLLBACK');
        console.error('Error guardando diarios:', e);
    }
};

export const getJournals = async () => {
    await initDB();
    const db = await getDb();
    return await db.getAllAsync('SELECT * FROM account_journals');
};

// Payments
export const saveAccountPayments = async (payments: any[]) => {
    await initDB();
    const db = await getDb();
    const extractId = (val: any) => Array.isArray(val) ? val[0] : (val || 0);

    await db.execAsync('BEGIN TRANSACTION');
    try {
        for (const p of payments) {
            await db.runAsync(
                `INSERT OR REPLACE INTO account_payments (id, amount, payment_date, journal_id, partner_id, invoice_id, memo, sync_status, is_local, company_id, user_id) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', 0, ?, ?)`,
                [
                    p.id || 0,
                    p.amount || 0,
                    p.date || '',
                    extractId(p.journal_id),
                    extractId(p.partner_id),
                    null, 
                    p.ref || p.memo || '',
                    p.company_id ? extractId(p.company_id) : 0,
                    p.user_id ? extractId(p.user_id) : (p.create_uid ? extractId(p.create_uid) : 0)
                ]
            );
        }
        await db.execAsync('COMMIT');
        console.log(`[SQLITE] Éxito: ${payments.length} cobranzas guardadas.`);
    } catch (e) {
        await db.execAsync('ROLLBACK');
        console.error('Error guardando account_payments:', e);
    }
};

export const saveLocalPayment = async (payment: any) => {
    await initDB();
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
