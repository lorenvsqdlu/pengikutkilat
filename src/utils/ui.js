module.exports = {
  async sendOrEdit(ctx, text, extra = {}) {
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(text, extra);
        return;
      } catch (e) {
        // Fallback to reply if edit fails
        await ctx.reply(text, extra);
      }
    } else {
      await ctx.reply(text, extra);
    }
  }
};
