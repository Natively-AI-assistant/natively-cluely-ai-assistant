const crypto = require('node:crypto');
const path = require('node:path');
const native = require(path.join(__dirname, '..', 'native-module'));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);

async function testDevice(label, device) {
  const result = { label, endpointHash: hash(device.id), friendlyName: device.name, initialized: false, chunks: 0, bytes: 0, asyncErrors: [] };
  let capture;
  try {
    capture = new native.MicrophoneCapture(device.id === 'default' ? null : device.id); result.initialized = true;
    capture.start((error, chunk) => { if (error) result.asyncErrors.push(error.message); else if (chunk?.length) { result.chunks++; result.bytes += chunk.length; } });
    await wait(1_500); capture.stop();
  } catch (error) { result.error = error.message; try { capture?.stop(); } catch {} }
  result.status = result.initialized && result.asyncErrors.length === 0 ? 'SUCCESS' : 'FAILED';
  return result;
}

(async () => {
  const devices = native.getInputDevices();
  const explicit = devices.filter(device => device.id !== 'default');
  const ugreen = explicit.find(device => /ugreen/i.test(device.name));
  const control = explicit.find(device => !/ugreen|usb/i.test(device.name)) || explicit.find(device => device !== ugreen);
  const results = [await testDevice('default', devices.find(device => device.id === 'default') || { id: 'default', name: 'Default Microphone' })];
  if (ugreen) results.push(await testDevice('ugreen', ugreen));
  if (control) results.push(await testDevice('control', control));
  const report = {
    status: results.every(item => item.status === 'SUCCESS') ? 'SUCCESS' : 'PARTIAL',
    microphoneGeneralCapture: results.some(item => item.label !== 'ugreen' && item.status === 'SUCCESS') ? 'SUCCESS' : 'FAILED',
    ugreenDeviceCompatibility: ugreen ? results.find(item => item.label === 'ugreen').status : 'NOT_FOUND',
    rawAudioPersisted: false,
    devices: results,
  };
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.status === 'SUCCESS' ? 0 : 1;
})().catch(error => { console.error(JSON.stringify({ status: 'FAILED', error: error.message })); process.exitCode = 1; });
