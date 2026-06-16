const db = require('../database');
const logger = require('../utils/logger');

async function runDailyReconciliation(bot) {
    logger.info('[RECONCILIATION] Starting daily financial reconciliation...');
    try {
        const adminIdRaw = process.env.ADMIN_ID;
        if (!adminIdRaw) return;
        const adminIds = adminIdRaw.split(',').map(id => id.trim());

        // 1. Total User Balance
        const [userBalRes] = await db.query('SELECT SUM(balance) as total_balance FROM users');
        const totalUserBalance = Number(userBalRes[0].total_balance || 0);

        // 2. Total Approved Deposits
        const [depRes] = await db.query(`SELECT SUM(amount) as total_deposit FROM deposits WHERE status = 'Approved'`);
        const totalDeposit = Number(depRes[0].total_deposit || 0);

        // 3. Total Order Cost & User Payment
        const [orderRes] = await db.query(`SELECT SUM(price) as total_spent, SUM(cost_price) as provider_cost FROM orders WHERE status NOT IN ('Canceled', 'pending')`);
        const totalUserSpent = Number(orderRes[0].total_spent || 0);
        const totalProviderCost = Number(orderRes[0].provider_cost || 0);

        // 4. Total Refunds
        const [refundRes] = await db.query(`SELECT SUM(amount) as total_refund FROM refunds`);
        const totalRefunds = Number(refundRes[0].total_refund || 0);

        // Calculate discrepancy
        // Basic accounting formula: Deposits - User Spent + Refunds = Total Balance
        const calculatedBalance = totalDeposit - totalUserSpent + totalRefunds;
        const discrepancy = totalUserBalance - calculatedBalance;

        // 5. LEDGER CONSISTENCY CHECK
        // Check anomaly from balance_mutations
        const [ledgerRes] = await db.query(`SELECT SUM(balance_after - balance_before) as net_mutations FROM balance_mutations`);
        const netMutations = Number(ledgerRes[0].net_mutations || 0);

        const formatRupiah = (angka) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(angka);

        let report = `📊 *DAILY FINANCIAL RECONCILIATION*\n━━━━━━━━━━━━━━━━━━━━\n`;
        report += `👥 *Total Saldo User:* ${formatRupiah(totalUserBalance)}\n`;
        report += `📥 *Total Deposit Disetujui:* ${formatRupiah(totalDeposit)}\n`;
        report += `💸 *Total Order Dibayar User:* ${formatRupiah(totalUserSpent)}\n`;
        report += `🛡️ *Total API Provider Cost:* ${formatRupiah(totalProviderCost)}\n`;
        report += `🔁 *Total Refund ke User:* ${formatRupiah(totalRefunds)}\n\n`;
        report += `📐 *Kalkulasi Saldo Ekspektasi:* ${formatRupiah(calculatedBalance)}\n`;
        report += `⚠️ *Selisih Global:* ${formatRupiah(discrepancy)}\n`;
        report += `🔍 *Net Ledger Mutation:* ${formatRupiah(netMutations)}\n`;
        
        if (discrepancy !== 0 || netMutations !== totalUserBalance) {
            report += `\n🚨 *PERINGATAN: TERDAPAT SELISIH SALDO YANG TIDAK WAJAR / LEDGER ANOMALY!* Harap periksa tabel \`balance_mutations\`.`;
        } else {
            report += `\n✅ *Status Keuangan:* SEHAT (Tidak ada selisih)`;
        }

        // Send report to all admins
        if (bot) {
            for (const adminId of adminIds) {
                try {
                    await bot.telegram.sendMessage(adminId, report, { parse_mode: 'Markdown' });
                } catch(e) {
                    logger.error(`[RECONCILIATION] Gagal kirim pesan ke admin ${adminId}: ${e.message}`);
                }
            }
        }
        logger.info('[RECONCILIATION] Completed successfully.');

    } catch(err) {
        logger.error(`[RECONCILIATION] Failed running reconciliation: ${err.message}`);
    }
}

function startReconciliationJob(bot) {
    // Run every day at 00:00 (or simply every 24 hours from startup)
    setInterval(() => {
        runDailyReconciliation(bot);
    }, 24 * 60 * 60 * 1000); 
    // Wait an hour then first run to not spam on restart
    setTimeout(() => {
        runDailyReconciliation(bot);
    }, 60 * 60 * 1000);
}

module.exports = startReconciliationJob;
