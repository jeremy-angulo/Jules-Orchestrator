import { describe, it, expect, beforeEach } from 'vitest';
import { DataHygieneService, LeadData } from './data-hygiene';

describe('DataHygieneService', () => {
  let service: DataHygieneService;

  beforeEach(() => {
    service = new DataHygieneService();
  });

  describe('detectDuplicates', () => {
    it('should normalize company names by lowercasing and removing suffixes', () => {
      const lead1: LeadData = { entreprise: 'Apple Inc.', contact: 'John Doe' };
      const lead2: LeadData = { entreprise: 'apple', contact: 'John Doe' };

      expect(service.detectDuplicates(lead1)).toBe(service.detectDuplicates(lead2));
    });

    it('should handle LLC and extra spaces', () => {
      const lead1: LeadData = { entreprise: 'Google LLC', contact: 'Jane Doe' };
      expect(service.detectDuplicates(lead1)).toBe('google');
    });

    it('should handle multiple suffixes and punctuation', () => {
      const lead1: LeadData = { entreprise: 'OpenAI, Corp.', contact: 'Sam Altman' };
      expect(service.detectDuplicates(lead1)).toBe('openai');
    });

    it('should handle French company types', () => {
      const lead1: LeadData = { entreprise: 'Trefle SAS', contact: 'Louis' };
      expect(service.detectDuplicates(lead1)).toBe('trefle');
    });
  });

  describe('validateFormat', () => {
    it('should return true for valid specific emails', () => {
      const lead: LeadData = { entreprise: 'Test', contact: 'Test', email: 'john.doe@example.com' };
      expect(service.validateFormat(lead)).toBe(true);
    });

    it('should return false for structurally invalid emails', () => {
      const lead1: LeadData = { entreprise: 'Test', contact: 'Test', email: 'invalid-email' };
      const lead2: LeadData = { entreprise: 'Test', contact: 'Test', email: 'user@domain' }; // missing extension

      expect(service.validateFormat(lead1)).toBe(false);
      expect(service.validateFormat(lead2)).toBe(false);
    });

    it('should return false for generic role-based emails', () => {
      const genericEmails = [
        'info@example.com',
        'contact@test.com',
        'admin@domain.org',
        'hello@startup.io',
        'sales@company.net',
        'support@app.co',
        'webmaster@site.com'
      ];

      genericEmails.forEach(email => {
        const lead: LeadData = { entreprise: 'Test', contact: 'Test', email };
        expect(service.validateFormat(lead)).toBe(false);
      });
    });
  });

  describe('checkDataDecay', () => {
    it('should flag data older than 6 months as decayed', () => {
      const oldDate = new Date();
      oldDate.setMonth(oldDate.getMonth() - 7); // 7 months ago

      const lead: LeadData = { entreprise: 'Test', contact: 'Test', lastUpdated: oldDate };
      expect(service.checkDataDecay(lead)).toBe(true);
    });

    it('should not flag data newer than 6 months', () => {
      const recentDate = new Date();
      recentDate.setMonth(recentDate.getMonth() - 3); // 3 months ago

      const lead: LeadData = { entreprise: 'Test', contact: 'Test', lastUpdated: recentDate };
      expect(service.checkDataDecay(lead)).toBe(false);
    });

    it('should not flag data from exactly today', () => {
      const lead: LeadData = { entreprise: 'Test', contact: 'Test', lastUpdated: new Date() };
      expect(service.checkDataDecay(lead)).toBe(false);
    });

    it('should flag data with no lastUpdated date as decayed by default', () => {
      const lead: LeadData = { entreprise: 'Test', contact: 'Test' };
      expect(service.checkDataDecay(lead)).toBe(true);
    });
  });
});
