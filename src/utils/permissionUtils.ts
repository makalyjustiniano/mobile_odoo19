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
    const canInvoices = roles.has("sales_confirm") || isPortalAdmin;
    const canConfirmSales = roles.has("sales_confirm") || isPortalAdmin;
    const canDistribution = roles.has("distribution") || isPortalAdmin;
    const canCollections = roles.has("collections") || isPortalAdmin;

    return {
        is_admin: isPortalAdmin,
        role_codes: Array.from(roles).sort(),
        view_sales: canSales,
        create_sale: roles.has("sales_quote") || canConfirmSales,
        edit_sale: roles.has("sales_quote") || canConfirmSales,
        confirm_sale: canConfirmSales,
        view_invoices: canInvoices || canCollections,
        send_invoice_siat: canConfirmSales,
        annul_invoice_siat: canConfirmSales,
        view_contacts: canSales || canCollections,
        manage_contacts: canSales || canCollections,
        view_pickings: canDistribution,
        validate_pickings: canDistribution,
        view_receivables: canCollections,
        create_receipts: canCollections,
        view_settings: isPortalAdmin,
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

    if (perms.is_admin) {
        if (model === 'account.move') {
            return [
                "&", branchFilter,
                "&", ["move_type", "=", "out_invoice"],
                "&", ["state", "=", "posted"], ["amount_residual", ">", 0]
            ];
        }
        return [branchFilter];
    }

    // No-admins: Aplicamos filtros cruzados (Sucursal AND Vendedor/Usuario)
    switch (model) {
        case 'sale.order':
            return [
                "&", branchFilter,
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
                "&", ["picking_type_code", "=", "outgoing"], ["user_id", "=", uid]
            ];
        case 'stock.move':
            return [
                "&", branchFilter,
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

