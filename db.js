const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'orders.json');

const ensureDb = () => {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
  }
};

const readRecords = () => {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
};

const writeRecords = (records) => {
  fs.writeFileSync(DB_FILE, JSON.stringify(records, null, 2));
};

const list = () => readRecords();

const create = (record) => {
  const records = readRecords();
  records.push(record);
  writeRecords(records);
  return record;
};

const findById = (id) => readRecords().find((record) => record.id === id);

const update = (id, updates) => {
  const records = readRecords();
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) return null;

  records[index] = { ...records[index], ...updates };
  writeRecords(records);
  return records[index];
};

module.exports = {
  list,
  create,
  findById,
  update,
  getOrders: list,
  createOrder: create,
  getOrderById: findById,
  updateOrder: update
};
