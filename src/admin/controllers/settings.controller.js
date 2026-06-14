const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.index = async (req, res) => {
    try {
        const settings = await prisma.settings.findMany();
        
        let config = {
            markup_global: '20',
            markup_instagram: '20',
            markup_tiktok: '20',
            markup_youtube: '20',
            markup_telegram: '20',
            markup_facebook: '20'
        };

        settings.forEach(s => {
            if(config[s.setting_key] !== undefined) {
                config[s.setting_key] = s.setting_value;
            }
        });

        res.render('settings', { title: 'Pengaturan Markup', config });
    } catch(err) {
        res.status(500).send("Error loading settings");
    }
};

exports.update = async (req, res) => {
    try {
        const keys = ['markup_global', 'markup_instagram', 'markup_tiktok', 'markup_youtube', 'markup_telegram', 'markup_facebook'];
        
        for (let key of keys) {
            if (req.body[key]) {
                await prisma.settings.upsert({
                    where: { setting_key: key },
                    update: { setting_value: req.body[key] },
                    create: { setting_key: key, setting_value: req.body[key] }
                });
            }
        }

        await prisma.admin_logs.create({
            data: {
               admin_id: req.admin.id,
               action: 'Update Settings',
               details: 'Updated SMM markups via Web Admin'
            }
        });

        res.redirect('/admin/settings');
    } catch(err) {
        res.status(500).send("Error updating settings");
    }
};
