import { ValidationError } from 'class-validator';
import { toValidationDetails } from './api-validation.pipe.js';

describe('toValidationDetails', () => {
  it('returns no details for an empty error list', () => {
    expect(toValidationDetails([])).toEqual([]);
  });

  it('addresses a missing required field without including its value', () => {
    const error = Object.assign(new ValidationError(), {
      property: 'email',
      value: undefined,
      constraints: { isDefined: 'Email is required.' },
    });
    expect(toValidationDetails([error])).toEqual([
      { pointer: '/email', message: 'Email is required.' },
    ]);
  });

  it('addresses a nested array field through nodes without constraints', () => {
    const error = Object.assign(new ValidationError(), {
      property: 'answers',
      children: [
        Object.assign(new ValidationError(), {
          property: '0',
          children: [
            Object.assign(new ValidationError(), {
              property: 'value',
              constraints: { isString: 'Value must be text.' },
            }),
          ],
        }),
      ],
    });
    expect(toValidationDetails([error])).toEqual([
      { pointer: '/answers/0/value', message: 'Value must be text.' },
    ]);
  });

  it.each([
    { property: 'a/b~c', pointer: '/a~1b~0c' },
    { property: '~1', pointer: '/~01' },
    { property: '', pointer: '/' },
  ])('encodes property "$property" as "$pointer"', ({ property, pointer }) => {
    const error = Object.assign(new ValidationError(), {
      property,
      constraints: { isDefined: 'Field is required.' },
    });
    expect(toValidationDetails([error])).toEqual([
      { pointer, message: 'Field is required.' },
    ]);
  });

  it('uses the empty pointer for a root error with no property', () => {
    const error = Object.assign(new ValidationError(), {
      constraints: { unknownValue: 'The request is invalid.' },
    });
    expect(toValidationDetails([error])).toEqual([
      { pointer: '', message: 'The request is invalid.' },
    ]);
  });

  it('does not add an empty segment for an absent parent property', () => {
    const error = Object.assign(new ValidationError(), {
      children: [
        Object.assign(new ValidationError(), {
          property: 'email',
          constraints: { isEmail: 'Email must be valid.' },
        }),
      ],
    });
    expect(toValidationDetails([error])).toEqual([
      { pointer: '/email', message: 'Email must be valid.' },
    ]);
  });

  it('retains both parent and child failures', () => {
    const error = Object.assign(new ValidationError(), {
      property: 'profile',
      constraints: { isObject: 'Profile must be an object.' },
      children: [
        Object.assign(new ValidationError(), {
          property: 'email',
          constraints: { isEmail: 'Email must be valid.' },
        }),
      ],
    });
    expect(toValidationDetails([error])).toEqual([
      { pointer: '/profile', message: 'Profile must be an object.' },
      { pointer: '/profile/email', message: 'Email must be valid.' },
    ]);
  });

  it('ignores nodes without constraints or children', () => {
    expect(
      toValidationDetails([
        Object.assign(new ValidationError(), { property: 'email' }),
      ]),
    ).toEqual([]);
  });

  it('orders each field by constraint key rather than message text', () => {
    const error = Object.assign(new ValidationError(), {
      property: 'email',
      constraints: { ruleB: 'Alpha message.', ruleA: 'Zulu message.' },
    });
    expect(toValidationDetails([error])).toEqual([
      { pointer: '/email', message: 'Zulu message.' },
      { pointer: '/email', message: 'Alpha message.' },
    ]);
  });

  it('sorts by encoded pointer then constraint key regardless of input order', () => {
    const errors = [
      Object.assign(new ValidationError(), {
        property: '/',
        constraints: { ruleB: 'Slash last.', ruleA: 'Slash first.' },
      }),
      Object.assign(new ValidationError(), {
        property: 'email',
        constraints: {
          isEmail: 'Email must be valid.',
          isDefined: 'Email is required.',
        },
      }),
      Object.assign(new ValidationError(), {
        property: 'Z',
        constraints: { isDefined: 'Z is required.' },
      }),
    ];
    const expected = [
      { pointer: '/Z', message: 'Z is required.' },
      { pointer: '/email', message: 'Email is required.' },
      { pointer: '/email', message: 'Email must be valid.' },
      { pointer: '/~1', message: 'Slash first.' },
      { pointer: '/~1', message: 'Slash last.' },
    ];
    const reversed = errors.toReversed().map((error) =>
      Object.assign(new ValidationError(), error, {
        constraints: Object.fromEntries(
          Object.entries(error.constraints).toReversed(),
        ),
      }),
    );
    expect(toValidationDetails(errors)).toEqual(expected);
    expect(toValidationDetails(reversed)).toEqual(expected);
  });

  it('orders constraints globally when errors share a pointer', () => {
    const errors = [
      Object.assign(new ValidationError(), {
        property: 'email',
        constraints: { isEmail: 'Email must be valid.' },
      }),
      Object.assign(new ValidationError(), {
        property: 'email',
        constraints: { isDefined: 'Email is required.' },
      }),
    ];
    expect(toValidationDetails(errors)).toEqual([
      { pointer: '/email', message: 'Email is required.' },
      { pointer: '/email', message: 'Email must be valid.' },
    ]);
  });

  it('omits target, value and contexts from public details', () => {
    const secret = 'never-public-submitted-value';
    const error = Object.assign(new ValidationError(), {
      property: 'email',
      target: { password: secret },
      value: secret,
      contexts: { isEmail: { token: secret } },
      constraints: { isEmail: 'Email must be valid.' },
    });
    const details = toValidationDetails([error]);
    expect(details).toEqual([
      { pointer: '/email', message: 'Email must be valid.' },
    ]);
    expect(JSON.stringify(details)).not.toContain(secret);
  });

  it('does not mutate the supplied error tree', () => {
    const errors = [
      Object.assign(new ValidationError(), {
        property: 'profile',
        constraints: { ruleB: 'Second rule.', ruleA: 'First rule.' },
        children: [
          Object.assign(new ValidationError(), {
            property: 'a/b',
            value: 'private',
            constraints: { isDefined: 'Field is required.' },
          }),
        ],
      }),
      Object.assign(new ValidationError(), {
        property: 'email',
        constraints: { isEmail: 'Email must be valid.' },
      }),
    ];
    const original = structuredClone(errors);
    toValidationDetails(Object.freeze(errors));
    expect(errors).toEqual(original);
  });
});
