import axios from 'axios';
// import { IMember } from '../models/members';

export class IntegrationService {
  private readonly targetUrl: string = process.env.VERIVOTE_PUSH_URL || '';
  private readonly apiKey: string = process.env.VERIVOTE_API_KEY || '';

  /**
   * Transforms our internal DB model to the VeriVote External Schema
   */
  private transformForVeriVote(member: any) {
    return {
      external_id: member._id,
      full_name: member.fullName,
      designation: member.role,
      region: member.county,
      affiliation: member.party,
      meta: {
        education_count: member.education?.length || 0,
        hansard_records: member.hansardContributions?.length || 0,
        last_updated: new Date().toISOString()
      },
      source_verification: member.sourceUrls[0] || 'Scraped via VeriVote Engine'
    };
  }

  /**
   * Sends the POST request to the VeriVote platform
   */
  async pushMemberData(memberData: any) {
    if (!this.targetUrl) throw new Error("Push URL not configured");

    const payload = this.transformForVeriVote(memberData);

    const response = await axios.post(this.targetUrl, payload, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'X-VeriVote-Source': 'Data-Engine-Worker'
      },
      timeout: 10000 // 10 second timeout
    });

    return response.status;
  }
}

export const integrationService = new IntegrationService();