const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

let x402ModulePromise = null;

const getX402Module = () => {
  if (!x402ModulePromise) {
    x402ModulePromise = import('@bankofai/x402');
  }
  return x402ModulePromise;
};

module.exports = {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  PAYMENT_RESPONSE_HEADER,
  getX402Module
};
