/**
 * Replicación de la Lógica de Permisos de SIAT Portal (odoo19/enterprise/testing/testing_modules/siat_portal_web/controllers/main.py)
 */

export interface SiatPermissions {
    is_admin: boolean;
    role_codes: string[];
    view_sales: boolean;
    create_sale: boolean;
    edit_sale: boolean;
    confirm_sale: boolean;
    view_invoices: boolean;
    send_invoice_siat: boolean;
    annul_invoice_siat: boolean;
    view_contacts: boolean;
    manage_contacts: boolean;
    view_pickings: boolean;
    validate_pickings: boolean;
    view_receivables: boolean;
    create_receipts: boolean;
    view_settings: boolean;
}

/**
 * Calcula el objeto de permisos basado en los códigos de rol y estatus de admin.
 * Idéntico a _get_portal_permissions en Odoo.
 */
export const getPortalPermissions = (roleCodes: string[], isPortalAdmin: boolean): SiatPermissions => {
    // SEGURIDAD ESTRICTA: Solo usamos los roles explícitamente asignados en Odoo.
    // Si no hay roles y no es admin, no se otorga acceso a ningún módulo.
    const roles = new Set(roleCodes);
    
    // Si es admin, otorgamos todos los roles automáticamente
    if (isPortalAdmin) {
        ["admin", "sales_quote", "sales_confirm", "distribution", "collections"].forEach(r => roles.add(r));
    }
    const canSales = roles.has("sales_quote") || roles.has("sales_confirm") || isPortalAdmin;
    const canConfirmSales = roles.has("sales_confirm") || isPortalAdmin;
    const canCreateSales = roles.has("sales_quote") || isPortalAdmin;
    const canDistribution = roles.has("distribution") || isPortalAdmin;
    const canCollections = roles.has("collections") || isPortalAdmin;
    const canViewInventory = canDistribution || roles.has("sales_quote") || isPortalAdmin;

    return {
        is_admin: isPortalAdmin,
        role_codes: Array.from(roles).sort(),
        view_sales: canSales,
        create_sale: canCreateSales,
        edit_sale: canCreateSales,
        confirm_sale: canConfirmSales,
        view_invoices: roles.has("sales_confirm") || roles.has("collections") || isPortalAdmin,
        send_invoice_siat: canConfirmSales,
        annul_invoice_siat: canConfirmSales,
        view_contacts: canSales || canCollections,
        manage_contacts: canSales || canCollections,
        view_pickings: canDistribution,
        validate_pickings: canDistribution,
        view_receivables: canCollections,
        create_receipts: canCollections,
        view_settings: isPortalAdmin,
        view_inventory: canViewInventory,
    };
};




/**
 * Genera el dominio de Odoo para cada modelo.
 * Reclica EXACTAMENTE _sale_domain_for_user, _invoice_domain_for_user de Odoo.
 * Implementa "FILTER-FIRST" para optimizar descarga.
 */
export const getSiatDomain = (model: string, user: any, permissions?: SiatPermissions): any[] => {
    if (!user) return [];
    
    const perms = permissions || getPortalPermissions(user.role_codes || [], !!user.is_portal_admin);
    const companyIds = user.company_ids || (user.company_id ? [user.company_id] : []);
    const uid = Number(user.uid || user.id);
    
    // Filtro base de Sucursal: ESTRICTO.
    const branchFilter = ["company_id", "in", companyIds];

    // Filtro diario (Solo Hoy)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStartStr = today.toISOString().replace('T', ' ').substring(0, 19);

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayEndStr = todayEnd.toISOString().replace('T', ' ').substring(0, 19);

    const dailyFilter = ["&", ["date_order", ">=", todayStartStr], ["date_order", "<=", todayEndStr]];
    const dailyDeliveryFilter = ["&", ["scheduled_date", ">=", todayStartStr], ["scheduled_date", "<=", todayEndStr]];

    if (perms.is_admin) {
        if (model === 'account.move') {
            return [
                "&", branchFilter,
                "&", ["move_type", "=", "out_invoice"],
                "&", ["state", "=", "posted"], ["amount_residual", ">", 0]
            ];
        } else if (model === 'sale.order') {
            return ["&", branchFilter, ...dailyFilter.slice(1)];
        } else if (model === 'stock.picking' || model === 'stock.move') {
            // we will use the same filter. Odoo stock.picking has date_deadline or scheduled_date
            return ["&", branchFilter, ...dailyDeliveryFilter.slice(1)];
        }
        return [branchFilter];
    }

    // No-admins: Aplicamos filtros cruzados (Sucursal AND Vendedor/Usuario)
    switch (model) {
        case 'sale.order':
            return [
                "&", branchFilter,
                "&", ...dailyFilter.slice(1),
                ["user_id", "=", uid]
            ];
        case 'account.move':
            return [
                "&", branchFilter,
                "&", ["move_type", "=", "out_invoice"],
                "&", ["state", "=", "posted"],
                "&", ["amount_residual", ">", 0], ["invoice_user_id", "=", uid]
            ];
        case 'stock.picking':
            return [
                "&", branchFilter,
                "&", ...dailyDeliveryFilter.slice(1),
                "&", ["picking_type_code", "=", "outgoing"], ["user_id", "=", uid]
            ];
        case 'stock.move':
            // For stock.move in Odoo we use date
            const dailyMoveFilter = ["&", ["date", ">=", todayStartStr], ["date", "<=", todayEndStr]];
            return [
                "&", branchFilter,
                "&", ...dailyMoveFilter.slice(1),
                "&", ["picking_id.picking_type_code", "=", "outgoing"], ["picking_id.user_id", "=", uid]
            ];
        case 'account.payment':
            return [
                "&", branchFilter,
                "&", ["partner_type", "=", "customer"],
                "&", ["payment_type", "=", "inbound"], ["kral_user_id", "=", uid]
            ];
        case 'res.partner':
            return [branchFilter];
    }

    return [branchFilter];
};

