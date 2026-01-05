/**
 * Data Sanitizer Unit Tests
 * Tests for data masking and sensitive field removal
 */

const {
  maskEmail,
  maskIdCard,
  maskPhone,
  sanitizeUser,
  sanitizeUsers,
  sanitizePost,
  sanitizePosts,
  USER_SENSITIVE_FIELDS,
  USER_PRIVATE_FIELDS
} = require('../dataSanitizer');

describe('Data Sanitizer - Masking Functions', () => {
  describe('maskEmail', () => {
    test('should mask email correctly', () => {
      const result = maskEmail('example@gmail.com');
      expect(result).toMatch(/^ex\*\*\*le@gmail\.com$/);
    });

    test('should handle short email local part', () => {
      const result = maskEmail('ab@gmail.com');
      expect(result).toMatch(/^a\*\*\*@gmail\.com$/);
    });

    test('should handle empty email', () => {
      expect(maskEmail('')).toBe('');
      expect(maskEmail(null)).toBe('');
      expect(maskEmail(undefined)).toBe('');
    });

    test('should handle invalid email format', () => {
      expect(maskEmail('invalid-email')).toBe('***');
    });
  });

  describe('maskIdCard', () => {
    test('should mask ID card correctly', () => {
      const result = maskIdCard('110101199001011234');
      expect(result).toBe('1101***1234');
    });

    test('should handle short ID card', () => {
      const result = maskIdCard('1234');
      expect(result).toBe('***');
    });

    test('should handle empty ID card', () => {
      expect(maskIdCard('')).toBe('');
      expect(maskIdCard(null)).toBe('');
    });
  });

  describe('maskPhone', () => {
    test('should mask phone correctly', () => {
      const result = maskPhone('13800138000');
      expect(result).toBe('138****8000');
    });

    test('should handle short phone', () => {
      const result = maskPhone('123');
      expect(result).toBe('***');
    });

    test('should handle empty phone', () => {
      expect(maskPhone('')).toBe('');
      expect(maskPhone(null)).toBe('');
    });
  });
});

describe('Data Sanitizer - User Sanitization', () => {
  const mockUser = {
    id: 1,
    user_id: 'testuser',
    nickname: 'Test User',
    email: 'test@example.com',
    password: 'hashedpassword123',
    oauth2_id: 12345,
    is_active: 1,
    avatar: 'avatar.jpg',
    bio: 'Test bio'
  };

  describe('sanitizeUser', () => {
    test('should remove sensitive fields', () => {
      const result = sanitizeUser(mockUser);
      
      expect(result.password).toBeUndefined();
      expect(result.oauth2_id).toBeUndefined();
      expect(result.is_active).toBeUndefined();
    });

    test('should keep public fields', () => {
      const result = sanitizeUser(mockUser);
      
      expect(result.id).toBe(1);
      expect(result.user_id).toBe('testuser');
      expect(result.nickname).toBe('Test User');
      expect(result.avatar).toBe('avatar.jpg');
      expect(result.bio).toBe('Test bio');
    });

    test('should remove email for non-owner users', () => {
      const result = sanitizeUser(mockUser, { currentUserId: 999 });
      
      expect(result.email).toBeUndefined();
    });

    test('should keep email for owner', () => {
      const result = sanitizeUser(mockUser, { currentUserId: 1 });
      
      expect(result.email).toBe('test@example.com');
    });

    test('should keep email for admin', () => {
      const result = sanitizeUser(mockUser, { isAdmin: true });
      
      expect(result.email).toBe('test@example.com');
    });

    test('should mask email when includeMaskedEmail is true', () => {
      const result = sanitizeUser(mockUser, { 
        currentUserId: 999,
        includeMaskedEmail: true 
      });
      
      expect(result.email).toMatch(/\*\*\*/);
      expect(result.email).not.toBe('test@example.com');
    });

    test('should handle null user', () => {
      expect(sanitizeUser(null)).toBe(null);
      expect(sanitizeUser(undefined)).toBe(undefined);
    });

    test('should not modify original object', () => {
      const originalPassword = mockUser.password;
      sanitizeUser(mockUser);
      
      expect(mockUser.password).toBe(originalPassword);
    });
  });

  describe('sanitizeUsers', () => {
    test('should sanitize array of users', () => {
      const users = [mockUser, { ...mockUser, id: 2 }];
      const result = sanitizeUsers(users);
      
      expect(result.length).toBe(2);
      expect(result[0].password).toBeUndefined();
      expect(result[1].password).toBeUndefined();
    });

    test('should handle empty array', () => {
      expect(sanitizeUsers([])).toEqual([]);
    });

    test('should handle non-array input', () => {
      expect(sanitizeUsers(null)).toBe(null);
      expect(sanitizeUsers(undefined)).toBe(undefined);
    });
  });
});

describe('Data Sanitizer - Post Sanitization', () => {
  const mockPost = {
    id: 1,
    title: 'Test Post',
    content: 'Test content',
    password: 'should_be_removed',
    oauth2_id: 12345,
    user: {
      id: 1,
      nickname: 'Author',
      email: 'author@example.com',
      password: 'hashedpassword'
    }
  };

  describe('sanitizePost', () => {
    test('should remove sensitive fields from post', () => {
      const result = sanitizePost(mockPost);
      
      expect(result.password).toBeUndefined();
      expect(result.oauth2_id).toBeUndefined();
    });

    test('should sanitize nested user object', () => {
      const result = sanitizePost(mockPost);
      
      expect(result.user.password).toBeUndefined();
    });

    test('should keep public post fields', () => {
      const result = sanitizePost(mockPost);
      
      expect(result.id).toBe(1);
      expect(result.title).toBe('Test Post');
      expect(result.content).toBe('Test content');
    });

    test('should handle post without user object', () => {
      const postWithoutUser = { ...mockPost };
      delete postWithoutUser.user;
      
      const result = sanitizePost(postWithoutUser);
      expect(result.user).toBeUndefined();
    });
  });

  describe('sanitizePosts', () => {
    test('should sanitize array of posts', () => {
      const posts = [mockPost, { ...mockPost, id: 2 }];
      const result = sanitizePosts(posts);
      
      expect(result.length).toBe(2);
      expect(result[0].password).toBeUndefined();
      expect(result[1].password).toBeUndefined();
    });
  });
});

describe('Data Sanitizer - Constants', () => {
  test('USER_SENSITIVE_FIELDS should contain expected fields', () => {
    expect(USER_SENSITIVE_FIELDS).toContain('password');
    expect(USER_SENSITIVE_FIELDS).toContain('oauth2_id');
    expect(USER_SENSITIVE_FIELDS).toContain('is_active');
  });

  test('USER_PRIVATE_FIELDS should contain email', () => {
    expect(USER_PRIVATE_FIELDS).toContain('email');
  });
});
