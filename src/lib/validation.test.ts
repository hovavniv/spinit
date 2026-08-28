import { describe, expect, it } from 'vitest';
import { validateLogin, validateRegister } from './validation';

describe('validateLogin', () => {
  it('errors when email is empty', () => {
    const errors = validateLogin({ email: '', password: 'password123' });
    expect(errors.email).toBeTruthy();
  });

  it('errors when email is malformed', () => {
    const errors = validateLogin({ email: 'not-an-email', password: 'password123' });
    expect(errors.email).toBeTruthy();
  });

  it('errors when password is empty', () => {
    const errors = validateLogin({ email: 'foo@bar.com', password: '' });
    expect(errors.password).toBeTruthy();
  });

  it('has no errors for valid login values', () => {
    const errors = validateLogin({ email: 'foo@bar.com', password: 'password123' });
    expect(errors).toEqual({});
  });
});

describe('validateRegister', () => {
  const validValues = {
    name: 'Jane DJ',
    businessName: 'Jane Spins LLC',
    email: 'foo@bar.com',
    confirmEmail: 'foo@bar.com',
    phone: '5551234567',
    password: 'password123',
    confirmPassword: 'password123',
  };

  it('errors when name is empty', () => {
    const errors = validateRegister({ ...validValues, name: '' });
    expect(errors.name).toBeTruthy();
  });

  it('errors when DJ business name is empty', () => {
    const errors = validateRegister({ ...validValues, businessName: '' });
    expect(errors.businessName).toBeTruthy();
  });

  it('errors when email is malformed', () => {
    const errors = validateRegister({ ...validValues, email: 'not-an-email', confirmEmail: 'not-an-email' });
    expect(errors.email).toBeTruthy();
  });

  it('passes when confirm email differs only in case', () => {
    const errors = validateRegister({
      ...validValues,
      email: 'Foo@Bar.com',
      confirmEmail: 'foo@bar.com',
    });
    expect(errors.confirmEmail).toBeFalsy();
  });

  it('errors when confirm email is genuinely different', () => {
    const errors = validateRegister({
      ...validValues,
      email: 'foo@bar.com',
      confirmEmail: 'other@bar.com',
    });
    expect(errors.confirmEmail).toBeTruthy();
  });

  it('errors when phone is empty', () => {
    const errors = validateRegister({ ...validValues, phone: '' });
    expect(errors.phone).toBeTruthy();
  });

  it('errors when password is exactly 7 characters', () => {
    const errors = validateRegister({
      ...validValues,
      password: '1234567',
      confirmPassword: '1234567',
    });
    expect(errors.password).toBeTruthy();
  });

  it('passes the length rule when password is exactly 8 characters', () => {
    const errors = validateRegister({
      ...validValues,
      password: '12345678',
      confirmPassword: '12345678',
    });
    expect(errors.password).toBeFalsy();
  });

  it('errors when confirm password does not match', () => {
    const errors = validateRegister({
      ...validValues,
      password: 'password123',
      confirmPassword: 'password124',
    });
    expect(errors.confirmPassword).toBeTruthy();
  });

  it('has no errors for fully valid register values', () => {
    const errors = validateRegister(validValues);
    expect(errors).toEqual({});
  });
});
