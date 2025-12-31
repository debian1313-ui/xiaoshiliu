/**
 * Video Transcoder Unit Tests
 * Tests for aspect ratio preservation and resolution selection
 */

const { calculateAspectRatioSize, selectResolutions } = require('../videoTranscoder');
const config = require('../../config/config');

describe('Video Transcoder - Aspect Ratio Preservation', () => {
  describe('calculateAspectRatioSize', () => {
    test('should maintain 16:9 aspect ratio for landscape video', () => {
      const result = calculateAspectRatioSize(1920, 1080, 720);
      expect(result.width).toBe(1280);
      expect(result.height).toBe(720);
      // Verify aspect ratio is preserved (within small margin for rounding)
      const originalRatio = 1920 / 1080;
      const resultRatio = result.width / result.height;
      expect(Math.abs(originalRatio - resultRatio)).toBeLessThan(0.01);
    });

    test('should maintain 9:16 aspect ratio for portrait video', () => {
      const result = calculateAspectRatioSize(720, 1280, 360);
      // 720/1280 * 360 = 202.5 → Math.round() = 203 → adjust to even = 204
      expect(result.width).toBe(204);
      expect(result.height).toBe(360);
      // Verify aspect ratio is preserved
      const originalRatio = 720 / 1280;
      const resultRatio = result.width / result.height;
      expect(Math.abs(originalRatio - resultRatio)).toBeLessThan(0.01);
    });

    test('should maintain 4:3 aspect ratio', () => {
      const result = calculateAspectRatioSize(640, 480, 360);
      expect(result.width).toBe(480);
      expect(result.height).toBe(360);
      const originalRatio = 640 / 480;
      const resultRatio = result.width / result.height;
      expect(Math.abs(originalRatio - resultRatio)).toBeLessThan(0.01);
    });

    test('should return even dimensions for H.264 encoding', () => {
      const result = calculateAspectRatioSize(1921, 1081, 721);
      expect(result.width % 2).toBe(0);
      expect(result.height % 2).toBe(0);
    });
  });

  describe('selectResolutions', () => {
    const testResolutions = config.videoTranscoding.dash.resolutions;

    test('should include original quality option', () => {
      const result = selectResolutions(1920, 1080, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      const originalResolution = result.find(r => r.isOriginal);
      expect(originalResolution).toBeDefined();
      expect(originalResolution.width).toBe(1920);
      expect(originalResolution.height).toBe(1080);
      expect(originalResolution.bitrate).toBe(8000);
      expect(originalResolution.label).toBe('原始');
    });

    test('should generate at least 4 quality options for 1080p video', () => {
      const result = selectResolutions(1920, 1080, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      expect(result.length).toBeGreaterThanOrEqual(4);
      // Should have: 原始, 720p, 480p, 360p
      const labels = result.map(r => r.label || (r.height + 'p'));
      expect(labels).toContain('原始');
      expect(labels).toContain('720p');
      expect(labels).toContain('480p');
      expect(labels).toContain('360p');
    });

    test('should preserve aspect ratio for portrait video', () => {
      const result = selectResolutions(720, 1280, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      const sourceRatio = 720 / 1280;
      
      result.forEach(resolution => {
        if (!resolution.isOriginal) {
          const resolutionRatio = resolution.width / resolution.height;
          expect(Math.abs(sourceRatio - resolutionRatio)).toBeLessThan(0.01);
        }
      });
    });

    test('should not transcode to resolutions higher than source', () => {
      const result = selectResolutions(640, 360, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      result.forEach(resolution => {
        expect(resolution.height).toBeLessThanOrEqual(360);
      });
    });

    test('should skip resolutions equal to or higher than source height', () => {
      const result = selectResolutions(1920, 1080, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      // Should not include 1080p as target (source is 1080p)
      const nonOriginal = result.filter(r => !r.isOriginal);
      nonOriginal.forEach(resolution => {
        expect(resolution.height).toBeLessThan(1080);
      });
    });

    test('should handle 4K video correctly', () => {
      const result = selectResolutions(3840, 2160, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      expect(result.length).toBeGreaterThanOrEqual(5);
      // Should have: 原始, 1080p, 720p, 480p, 360p
      const labels = result.map(r => r.label || (r.height + 'p'));
      expect(labels).toContain('原始');
      expect(labels).toContain('1080p');
      expect(labels).toContain('720p');
    });

    test('should provide only original quality for very low resolution video', () => {
      const result = selectResolutions(320, 240, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      expect(result.length).toBe(1);
      expect(result[0].isOriginal).toBe(true);
      expect(result[0].width).toBe(320);
      expect(result[0].height).toBe(240);
    });

    test('should not distort aspect ratio (avoid 720x1280 to 640x360)', () => {
      const result = selectResolutions(720, 1280, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: 8000
      });
      
      // Find 360p resolution
      const resolution360p = result.find(r => r.height === 360);
      
      if (resolution360p) {
        // Should be approximately 203-204 x 360, NOT 640 x 360
        expect(resolution360p.width).toBeLessThan(300);
        expect(resolution360p.width).toBeGreaterThan(200);
        expect(resolution360p.height).toBe(360);
      }
    });

    test('should respect originalMaxBitrate configuration', () => {
      const customBitrate = 10000;
      const result = selectResolutions(1920, 1080, testResolutions, {
        includeOriginal: true,
        originalMaxBitrate: customBitrate
      });
      
      const originalResolution = result.find(r => r.isOriginal);
      expect(originalResolution.bitrate).toBe(customBitrate);
    });
  });
});

module.exports = {
  // Export for potential integration tests
};
