const test = require('node:test');

test('CI detecta un fallo controlado temporal', () => {
  throw new Error('Fallo deliberado: verificación rojo→verde de CI');
});
