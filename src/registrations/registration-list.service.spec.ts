import { registrantProfile } from './registration-list.service.js';

const person = { phoneNumber: '+966500000000', major: 'Software Engineering', member: { isActive: true } };

describe('registrantProfile', () => {
  it('always reports membership from the account', () => {
    expect(registrantProfile(person, [])).toEqual({ membership: true });
    expect(registrantProfile({ ...person, member: null }, [])).toEqual({ membership: false });
    expect(registrantProfile({ ...person, member: { isActive: false } }, [])).toEqual({ membership: false });
  });

  it('shares phone and major only when the event asks for them', () => {
    expect(registrantProfile(person, ['phone'])).toEqual({ membership: true, phone: '+966500000000' });
    expect(registrantProfile(person, ['phone', 'major'])).toEqual({ membership: true, phone: '+966500000000', major: 'Software Engineering' });
  });
});
