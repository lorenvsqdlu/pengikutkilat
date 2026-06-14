const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

exports.index = async (req, res) => {
    try {
        const banks = await prisma.banks.findMany();
        res.render('banks', { title: 'Kelola Rekening', banks });
    } catch(err) {
        res.status(500).send("Error loading banks");
    }
};

exports.add = async (req, res) => {
    try {
        await prisma.banks.create({
            data: {
                bank_name: req.body.bank_name,
                account_number: req.body.account_number,
                account_name: req.body.account_name,
                is_active: true
            }
        });
        await prisma.admin_logs.create({
             data: {
               admin_id: req.admin.id,
               action: 'Tambah Rekening',
               details: `Bank: ${req.body.bank_name}`
             }
        });
        res.redirect('/admin/banks');
    } catch(err) {
        res.status(500).send("Error adding bank");
    }
};

exports.update = async (req, res) => {
    try {
        await prisma.banks.update({
            where: { id: parseInt(req.params.id) },
            data: {
                bank_name: req.body.bank_name,
                account_number: req.body.account_number,
                account_name: req.body.account_name,
            }
        });
        await prisma.admin_logs.create({
             data: {
               admin_id: req.admin.id,
               action: 'Edit Rekening',
               details: `ID: ${req.params.id}`
             }
        });
        res.redirect('/admin/banks');
    } catch(err) {
        res.status(500).send("Error updating bank");
    }
};

exports.toggle = async (req, res) => {
    try {
        const bank = await prisma.banks.findUnique({ where: { id: parseInt(req.params.id) } });
        if(bank) {
            await prisma.banks.update({
                where: { id: bank.id },
                data: { is_active: !bank.is_active }
            });
            await prisma.admin_logs.create({
                 data: {
                   admin_id: req.admin.id,
                   action: bank.is_active ? 'Nonaktifkan Rekening' : 'Aktifkan Rekening',
                   details: `ID: ${bank.id}`
                 }
            });
        }
        res.redirect('/admin/banks');
    } catch(err) {
        res.status(500).send("Error toggling bank");
    }
};

exports.delete = async (req, res) => {
    try {
        await prisma.banks.delete({
            where: { id: parseInt(req.params.id) }
        });
        await prisma.admin_logs.create({
             data: {
               admin_id: req.admin.id,
               action: 'Hapus Rekening',
               details: `ID: ${req.params.id}`
             }
        });
        res.redirect('/admin/banks');
    } catch(err) {
        res.status(500).send("Error deleting bank");
    }
};
