export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  phone?: string;
  storageMode: 'managed' | 'byod';
  createdAt?: Date;
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
  phone: string;
  storageMode: 'managed' | 'byod';
}

export interface OTPVerification {
  phone: string;
  otp: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

export interface AuthError {
  message: string;
  code: string;
}
