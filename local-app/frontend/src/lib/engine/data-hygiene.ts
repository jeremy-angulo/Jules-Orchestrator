export interface LeadData {
  id?: string;
  entreprise: string;
  contact: string;
  email?: string;
  lastUpdated?: Date;
  [key: string]: any;
}

export class DataHygieneService {
  /**
   * Normalizes the company name to detect duplicates.
   * e.g. "Apple Inc." -> "apple", "Google LLC" -> "google"
   */
  public detectDuplicates(lead: LeadData): string {
    if (!lead.entreprise) return '';
    let name = lead.entreprise.toLowerCase();
    name = name.replace(/\b(inc\.?|llc|ltd\.?|corp\.?|sa|sas|sarl)\b/g, '');
    // remove punctuation and extra spaces
    name = name.replace(/[^\w\s]/g, '').trim();
    return name;
  }

  /**
   * Validates the structural validity of the email and blocks generic roles.
   * e.g. "info@", "contact@"
   */
  public validateFormat(lead: LeadData): boolean {
    if (!lead.email) return false;

    // Check basic email structure
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(lead.email)) {
      return false;
    }

    const emailPrefix = lead.email.split('@')[0].toLowerCase();
    const genericPrefixes = ['info', 'contact', 'admin', 'hello', 'sales', 'support', 'webmaster'];

    if (genericPrefixes.includes(emailPrefix)) {
      return false; // Blocks generic emails
    }

    return true; // Email is valid and not generic
  }

  /**
   * Flags a lead if its last update was more than 6 months ago.
   * Returns true if the data is older than 6 months, false otherwise.
   */
  public checkDataDecay(lead: LeadData): boolean {
    if (!lead.lastUpdated) {
      return true; // No date means it's considered decayed/invalid for strict checking
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // If the last updated date is before the date 6 months ago, it has decayed.
    return lead.lastUpdated < sixMonthsAgo;
  }
}
