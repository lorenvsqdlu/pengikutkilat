const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fs = require('fs');
const path = require('path');

exports.index = async (req, res) => {
    try {
        const qris = await prisma.qris_accounts.findMany();
        res.render('qris', { title: 'Kelola QRIS', qris });
    } catch(err) {
        res.status(500).send("Error loading QRIS");
    }
};

exports.add = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).send('Foto QRIS wajib diupload');
        }
        
        await prisma.qris_accounts.create({
            data: {
                qris_name: req.body.qris_name,
                qris_image: '/uploads/qris/' + req.file.filename,
                is_active: true
            }
        });
        
        await prisma.admin_logs.create({
             data: {
               admin_id: req.admin.id,
               action: 'Tambah QRIS',
               details: `QRIS: ${req.body.qris_name}`
             }
        });
        res.redirect('/admin/qris');
    } catch(err) {
        res.status(500).send("Error adding QRIS");
    }
};

exports.update = async (req, res) => {
    try {
        const data = { qris_name: req.body.qris_name };
        if(req.file) {
            data.qris_image = '/uploads/qris/' + req.file.filename;
        }

        await prisma.qris_accounts.update({
            where: { id: parseInt(req.params.id) },
            data
        });
        await prisma.admin_logs.create({
             data: {
               admin_id: req.admin.id,
               action: 'Edit QRIS',
               details: `ID: ${req.params.id}`
             }
        });
        res.redirect('/admin/qris');
    } catch(err) {
        res.status(500).send("Error updating QRIS");
    }
};

exports.toggle = async (req, res) => {
    try {
        const qrisObj = await prisma.qris_accounts.findUnique({ where: { id: parseInt(req.params.id) } });
        if(qrisObj) {
            await prisma.qris_accounts.update({
                where: { id: qrisObj.id },
                data: { is_active: !qrisObj.is_active }
            });
            await prisma.admin_logs.create({
                 data: {
                   admin_id: req.admin.id,
                   action: qrisObj.is_active ? 'Nonaktifkan QRIS' : 'Aktifkan QRIS',
                   details: `ID: ${qrisObj.id}`
                 }
            });
        }
        res.redirect('/admin/qris');
    } catch(err) {
        res.status(500).send("Error toggling QRIS");
    }
};

exports.delete = async (req, res) => {
    try {
        await prisma.qris_accounts.delete({
            where: { id: parseInt(req.params.id) }
        });
        await prisma.admin_logs.create({
             data: {
               admin_id: req.admin.id,
               action: 'Hapus QRIS',
               details: `ID: ${req.params.id}`
             }
        });
        res.redirect('/admin/qris');
    } catch(err) {
        res.status(500).send("Error deleting QRIS");
    }
};
