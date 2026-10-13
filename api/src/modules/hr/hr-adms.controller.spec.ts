import 'reflect-metadata';
import { HrAdmsController } from './hr-adms.controller';

describe('ADMS controller wiring', () => {
  // The global ValidationPipe (whitelist + forbidNonWhitelisted) validates any parameter whose
  // runtime type is a class. Terminals send arbitrary query keys (SN, table, Stamp, options…),
  // so the query/body parameters must stay plain objects or every push is refused with 400.
  it.each(['handshake', 'upload', 'poll', 'commandResult'])('%s query param is a plain object', (method) => {
    const types = Reflect.getMetadata('design:paramtypes', HrAdmsController.prototype, method) as unknown[];
    expect(types[0]).toBe(Object);
  });

  it('upload body param is a plain object', () => {
    const types = Reflect.getMetadata('design:paramtypes', HrAdmsController.prototype, 'upload') as unknown[];
    expect(types[1]).toBe(Object);
  });
});
