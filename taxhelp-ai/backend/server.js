const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const taxRoutes = require('./routes/tax');
const paymentRoutes = require('./routes/payment');
const ocrRoutes = require('./routes/ocr');
const pdfRoutes = require('./routes/pdf');

const app = express();

app.use(cors());
app.use(bodyParser.json());

app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/pdf', pdfRoutes);

module.exports = app;
