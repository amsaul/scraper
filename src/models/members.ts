import mongoose from "mongoose";

// ==================== Education Schema ====================
const EducationSchema = new mongoose.Schema({
  from: String,
  to: String,
  institution: { type: String, required: true },
  qualification: String,
}, { _id: false });

// ==================== Project Schema ====================
const ProjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  budget: Number,
  status: {
    type: String,
    enum: ["planned", "ongoing", "completed", "stalled", "proposed"]
  },
  location: String,
  completionDate: Date,
  sourceUrl: String
}, { _id: false });

// ==================== Committee Schema ====================
const CommitteeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  role: String,
  from: Date,
  to: Date
}, { _id: false });

// ==================== Experience Schema ====================
const ExperienceSchema = new mongoose.Schema({
  title: { type: String, required: true },
  organization: String,
  from: Date,
  to: Date,
  description: String
}, { _id: false });

// ==================== Hansard Contribution Schema ====================
const HansardContributionSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  topic: String,
  content: String,
  transcriptUrl: String,
}, { _id: false });

// ==================== Corruption Citation Schema ====================
const CorruptionCitationSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  sourceUrl: String,
  date: Date,
  status: {
    type: String,
    enum: ["allegation", "investigation", "charges", "conviction", "cleared"]
  }
}, { _id: false });

// ==================== Cabinet Member Schema (for President/Governors) ====================
const CabinetMemberSchema = new mongoose.Schema({
  position: { type: String, required: true },
  appointee: { type: String, required: true },
  department: String,
  from: Date,
  to: Date
}, { _id: false });

// ==================== County Assembly Schema (for Governors) ====================
const CountyAssemblySchema = new mongoose.Schema({
  speaker: String,
  majorityLeader: String,
  minorityLeader: String,
  wards: { type: Number, default: 0 },
  totalMembers: { type: Number, default: 0 }
}, { _id: false });

// ==================== Development Project Schema (for Governors) ====================
const DevelopmentProjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  sector: { type: String, enum: ["Health", "Education", "Infrastructure", "Agriculture", "Water", "Trade", "Other"] },
  budget: Number,
  status: {
    type: String,
    enum: ["planned", "ongoing", "completed", "stalled"]
  },
  location: String,
  completionDate: Date,
  sourceUrl: String
}, { _id: false });

// ==================== Presidential-Specific Schema ====================
const PresidentialSchema = {
  // Executive Leadership
  deputyPresident: String,
  primeCabinetSecretary: String,
  attorneyGeneral: String,
  
  // Cabinet (National)
  cabinetSecretaries: [CabinetMemberSchema],
  principalSecretaries: [CabinetMemberSchema],
  
  // Key Presidential Initiatives
  presidentialInitiatives: [{
    name: String,
    description: String,
    launchDate: Date,
    status: String,
    achievements: [String]
  }],
  
  // State Departments
  stateDepartments: [{
    name: String,
    principalSecretary: String,
    ministry: String
  }],
  
  // Diplomatic Relations
  foreignPolicy: String,
  internationalAgreements: [{
    title: String,
    country: String,
    signedDate: Date,
    description: String
  }],
  
  // Constitutional Commissions
  constitutionalCommissions: [{
    name: String,
    chairperson: String,
    established: Date
  }]
};

// ==================== Governor-Specific Schema ====================
const GovernorSpecificSchema = {
  // Term Information
  termStart: { type: Number, default: 2022 },
  termEnd: { type: Number, default: 2027 },
  dateAssumedOffice: Date,
  previousGovernor: String,
  
  // Deputy Governor
  deputyGovernor: String,
  deputyGovernorContact: {
    phone: String,
    email: String
  },
  
  // County Information
  countyHeadquarters: String,
  countyWebsite: String,
  countyEmail: String,
  countyPhone: String,
  countyPopulation: Number,
  countyArea: String,
  
  // Administration
  cabinet: [CabinetMemberSchema],
  chiefOfficers: [CabinetMemberSchema],
  countyAssembly: CountyAssemblySchema,
  
  // Development
  developmentProjects: [DevelopmentProjectSchema],
  developmentAgenda: String,
  flagshipProjects: [String],
  
  // Social Media
  socialMedia: {
    twitter: String,
    facebook: String,
    instagram: String,
    youtube: String
  },
  
  // County Statistics
  statistics: {
    budget: Number,
    revenue: Number,
    expenditure: Number,
    unemploymentRate: Number,
    povertyRate: Number
  }
};

// ==================== Senator/MP Specific Schema ====================
const ParliamentarySchema = {
  // Parliamentary Leadership
  parliamentaryGroup: String, // e.g., "Majority", "Minority"
  whipPosition: String, // e.g., "Chief Whip", "Deputy Whip"
  
  // Bills Sponsored
  billsSponsored: [{
    title: String,
    dateIntroduced: Date,
    status: String, // "proposed", "passed", "defeated"
    description: String
  }],
  
  // Petitions
  petitions: [{
    title: String,
    petitioners: String,
    datePresented: Date,
    status: String
  }]
};

// ==================== Main Member Schema ====================
const MemberSchema = new mongoose.Schema({
  // ===== Core fields for all politicians =====
  fullName: { type: String, required: true, trim: true, index: true },
  firstName: { type: String, trim: true, default: null },
  middleName: { type: String, trim: true, default: null },
  lastName: { type: String, trim: true, default: null },
  gender: { type: String, enum: ['Male', 'Female', 'Other'], default: null },

  role: {
    type: String,
    required: true,
    enum: [
      // National Executive
      "President", "Deputy President", 
      
      // County Executive
      "Governor", "Deputy Governor", 
      
      // Legislature - National
      "Senator", "MP", "Women Representative", 
      
      // Legislature - County
      "MCA", 
      
      // Appointed/Nominated
      "Nominated Senator", "Nominated MP", "Nominated MCA",
      "Cabinet Secretary", "Principal Secretary", "Attorney General",
      
      // Other
      "Speaker", "Deputy Speaker", "Majority Leader", "Minority Leader",
      "Chief Whip", "Deputy Whip"
    ],
    index: true
  },
  party: { type: String, index: true },
  
  // ===== Location fields (hierarchical) =====
  county: { type: String, index: true },
  constituency: { type: String, index: true },
  ward: { type: String, index: true },
  
  // ===== Position-specific fields =====
  position: String, // e.g., 'Majority Leader', 'Chief Whip', 'Speaker'
  status: {
    type: String,
    enum: ["Elected", "Nominated", "Appointed", "Acting", "Interim"]
  },
  
  // ===== Contact & Profile =====
  phone: String,
  email: String,
  website: String,
  profileImage: String,
  bio: String,
  dateOfBirth: Date,
  placeOfBirth: String,
  // gender: { type: String, enum: ["Male", "Female", "Other"] },
  
  // ===== Professional background =====
  education: [EducationSchema],
  profession: [String],
  experience: [ExperienceSchema],
  professionalAffiliations: [String],
  honours: [String],
  
  // ===== Political work =====
  committees: [CommitteeSchema],
  
  // ===== Development projects (general) =====
  projects: [ProjectSchema],
  
  // ===== Parliamentary contributions =====
  hansardContributions: [HansardContributionSchema],
  
  // ===== Legal/Citations =====
  corruptionCitations: [CorruptionCitationSchema],
  
  // ===== Role-specific fields =====
  
  // --- Presidential fields ---
  deputyPresident: String,
  primeCabinetSecretary: String,
  attorneyGeneral: String,
  cabinetSecretaries: [CabinetMemberSchema],
  principalSecretaries: [CabinetMemberSchema],
  presidentialInitiatives: [{
    name: String,
    description: String,
    launchDate: Date,
    status: String,
    achievements: [String]
  }],
  stateDepartments: [{
    name: String,
    principalSecretary: String,
    ministry: String
  }],
  foreignPolicy: String,
  internationalAgreements: [{
    title: String,
    country: String,
    signedDate: Date,
    description: String
  }],
  constitutionalCommissions: [{
    name: String,
    chairperson: String,
    established: Date
  }],
  
  // --- Governor fields ---
  termStart: { type: Number, default: 2022 },
  termEnd: { type: Number, default: 2027 },
  dateAssumedOffice: Date,
  previousGovernor: String,
  deputyGovernor: String,
  deputyGovernorContact: {
    phone: String,
    email: String
  },
  countyHeadquarters: String,
  countyWebsite: String,
  countyEmail: String,
  countyPhone: String,
  countyPopulation: Number,
  countyArea: String,
  cabinet: [CabinetMemberSchema],
  chiefOfficers: [CabinetMemberSchema],
  countyAssembly: CountyAssemblySchema,
  developmentProjects: [DevelopmentProjectSchema],
  developmentAgenda: String,
  flagshipProjects: [String],
  socialMedia: {
    twitter: String,
    facebook: String,
    instagram: String,
    youtube: String
  },
  statistics: {
    budget: Number,
    revenue: Number,
    expenditure: Number,
    unemploymentRate: Number,
    povertyRate: Number
  },
  
  // --- Parliamentary fields ---
  parliamentaryGroup: String,
  whipPosition: String,
  billsSponsored: [{
    title: String,
    dateIntroduced: Date,
    status: String,
    description: String
  }],
  petitions: [{
    title: String,
    petitioners: String,
    datePresented: Date,
    status: String
  }],
  
  // ===== For MCAs =====
  wardProjects: [{
    title: String,
    description: String,
    budget: Number,
    status: String,
    completionDate: Date,
    location: String
  }],
  
  // ===== Metadata =====
  sourceUrls: [String],
  lastUpdated: { type: Date, default: Date.now },
  
  // ===== Push tracking =====
  pushStatus: { type: String, default: 'pending', enum: ['pending', 'success', 'failed'] },
  lastPushAttempt: Date,
  pushError: String
  
}, { 
  timestamps: true // Adds createdAt and updatedAt automatically
});

// ==================== Indexes for common queries ====================
MemberSchema.index({ role: 1, county: 1 });
MemberSchema.index({ role: 1, party: 1 });
MemberSchema.index({ county: 1, constituency: 1, ward: 1 });
MemberSchema.index({ fullName: "text", party: "text", county: "text", role: "text" }); // For search

// ==================== Virtual fields ====================
MemberSchema.virtual('isPresident').get(function() {
  return this.role === 'President' || this.role === 'Deputy President';
});

MemberSchema.virtual('isGovernor').get(function() {
  return this.role === 'Governor' || this.role === 'Deputy Governor';
});

MemberSchema.virtual('isMP').get(function() {
  return this.role === 'MP';
});

MemberSchema.virtual('isSenator').get(function() {
  return this.role === 'Senator';
});

MemberSchema.virtual('isMCA').get(function() {
  return this.role === 'MCA';
});

MemberSchema.virtual('isNominated').get(function() {
  return this.role.includes('Nominated');
});

MemberSchema.virtual('termDuration').get(function() {
  if (this.termStart && this.termEnd) {
    return `${this.termStart} - ${this.termEnd}`;
  }
  return 'Unknown';
});

MemberSchema.virtual('fullLocation').get(function() {
  const parts = [];
  if (this.county) parts.push(this.county);
  if (this.constituency) parts.push(this.constituency);
  if (this.ward) parts.push(this.ward);
  return parts.join(' › ') || 'N/A';
});

// ==================== Methods ====================
MemberSchema.methods.getFullProfile = function() {
  const base = {
    basic: {
      name: this.fullName,
      role: this.role,
      party: this.party,
      location: {
        county: this.county,
        constituency: this.constituency,
        ward: this.ward
      },
      contact: {
        phone: this.phone,
        email: this.email,
        website: this.website,
        social: this.socialMedia
      },
      professional: {
        education: this.education,
        experience: this.experience,
        committees: this.committees,
        honours: this.honours
      }
    }
  };

  // Add role-specific data
  if (this.role === 'President' || this.role === 'Deputy President') {
    return {
      ...base,
      executive: {
        deputyPresident: this.deputyPresident,
        primeCabinetSecretary: this.primeCabinetSecretary,
        attorneyGeneral: this.attorneyGeneral,
        cabinetSecretaries: this.cabinetSecretaries,
        principalSecretaries: this.principalSecretaries,
        initiatives: this.presidentialInitiatives,
        foreignPolicy: this.foreignPolicy,
        internationalAgreements: this.internationalAgreements
      }
    };
  }

  if (this.role === 'Governor' || this.role === 'Deputy Governor') {
    return {
      ...base,
      governor: {
        term: this.termDuration,
        deputy: this.deputyGovernor,
        countyInfo: {
          headquarters: this.countyHeadquarters,
          population: this.countyPopulation,
          area: this.countyArea,
          website: this.countyWebsite,
          email: this.countyEmail,
          phone: this.countyPhone
        },
        administration: {
          cabinet: this.cabinet,
          chiefOfficers: this.chiefOfficers,
          countyAssembly: this.countyAssembly
        },
        development: {
          agenda: this.developmentAgenda,
          projects: this.developmentProjects,
          flagship: this.flagshipProjects
        },
        statistics: this.statistics
      }
    };
  }

  if (this.role === 'Senator' || this.role === 'MP' || this.role === 'Women Representative') {
    return {
      ...base,
      parliamentary: {
        group: this.parliamentaryGroup,
        whip: this.whipPosition,
        billsSponsored: this.billsSponsored,
        petitions: this.petitions,
        hansardContributions: this.hansardContributions
      }
    };
  }

  if (this.role === 'MCA') {
    return {
      ...base,
      mca: {
        wardProjects: this.wardProjects,
        ward: this.ward
      }
    };
  }

  return base;
};

export default mongoose.model("Member", MemberSchema);