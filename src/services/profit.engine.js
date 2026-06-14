const db = require('../database');

class ProfitEngine {
  static async getCategoryMargin(categoryName) {
    if (!categoryName) return null;
    const query = `SELECT * FROM category_margins WHERE category_name = ?`;
    const [rows] = await db.query(query, [categoryName]);
    return rows.length ? rows[0] : null;
  }

  static async getGlobalMargin() {
    const query = `SELECT value FROM settings WHERE \`key\` = 'markup_percent'`;
    const [rows] = await db.query(query);
    return rows.length && rows[0].value ? parseFloat(rows[0].value) : 20; // Default 20%
  }

  static async calculatePrice(servicePricePer1000, quantity, categoryName) {
    const costPer1000 = parseFloat(servicePricePer1000) || 0;
    const costPrice = (costPer1000 / 1000) * quantity;

    let marginVal = 0;
    let marginType = 'percent';

    const catMargin = await this.getCategoryMargin(categoryName);
    
    if (catMargin) {
      marginType = catMargin.margin_type;
      marginVal = parseFloat(catMargin.margin_value) || 0;
    } else {
      marginVal = await this.getGlobalMargin();
      marginType = 'percent';
    }

    let marginAmount = 0;
    if (marginType === 'percent') {
      marginAmount = costPrice * (marginVal / 100);
    } else {
      marginAmount = marginVal; 
    }

    let sellPrice = costPrice + marginAmount;

    // Safety rules
    if (sellPrice < costPrice) {
      sellPrice = costPrice;
    }

    const profit = sellPrice - costPrice;

    return {
      cost_price: parseFloat(costPrice.toFixed(2)),
      sell_price: parseFloat(sellPrice.toFixed(2)),
      profit: parseFloat(profit.toFixed(2))
    };
  }

  static async getTotalProfit() {
    const [rows] = await db.query(`SELECT SUM(profit) as total FROM orders WHERE status = 'completed' OR status = 'Completed'`);
    return rows[0].total || 0;
  }

  static async getDailyProfit() {
    const [rows] = await db.query(`SELECT SUM(profit) as total FROM orders WHERE (status = 'completed' OR status = 'Completed') AND DATE(created_at) = CURDATE()`);
    return rows[0].total || 0;
  }

  static async getProfitByCategory() {
    const [rows] = await db.query(`SELECT category, SUM(profit) as total FROM orders WHERE status = 'completed' OR status = 'Completed' GROUP BY category`);
    return rows;
  }
}

module.exports = ProfitEngine;
