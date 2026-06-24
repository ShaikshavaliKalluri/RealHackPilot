export interface Member {
  id: number;
  name: string;
  email: string | null;
  location: string | null;
  tshirt_size: string | null;
  /** Mailing address for swag shipping (US/PH only). */
  address: string | null;
  position: number;
}

export interface AIScoreAxis {
  score: number | null;
  reason: string;
}

export interface AIScores {
  summary?: string;
  genuineness?: AIScoreAxis;
  solution_clarity?: AIScoreAxis;
  business_value?: AIScoreAxis;
  novelty?: AIScoreAxis;
  overall?: { score: number | null; headline: string };
  provider?: string;
  model?: string;
  scored_at?: string;
  error?: string;
}

export interface JudgeAxisAI {
  score: number | null;
  reason: string;
}

export interface JudgeAxisHuman {
  score: number | null;
  comment: string;
}

export interface JudgeAI {
  problem_clarity?: JudgeAxisAI;
  solution_viability?: JudgeAxisAI;
  industry_readiness?: JudgeAxisAI;
  roi?: JudgeAxisAI;
  novelty?: JudgeAxisAI;
  overall?: number | null;
  headline?: string;
  provider?: string;
  model?: string;
  scored_at?: string;
  error?: string;
}

export interface JudgeHuman {
  problem_clarity?: JudgeAxisHuman;
  solution_viability?: JudgeAxisHuman;
  industry_readiness?: JudgeAxisHuman;
  roi?: JudgeAxisHuman;
  novelty?: JudgeAxisHuman;
  overall?: number | null;
  panelist?: string | null;
  updated_at?: string;
}

export interface GithubContext {
  owner?: string;
  repo?: string;
  description?: string | null;
  language?: string | null;
  stars?: number;
  forks?: number;
  pushed_at?: string;
  topics?: string[];
  license?: string | null;
  languages?: Record<string, number>;
  readme_excerpt?: string;
  html_url?: string;
  error?: string;
}

export interface JudgeScores {
  ai?: JudgeAI;
  human?: JudgeHuman;
  github?: GithubContext | null;
}

export interface Judge {
  id: number;
  name: string;
  email: string | null;
  role: string;
  is_active: boolean;
}

export interface RubricAxis {
  key: string;
  label: string;
  /** Weight as a percentage of the total score (e.g. 30 for 30%). Sum of
   *  all axes' weight_pct = 100. */
  weight_pct?: number;
  /** Long-form definition shown to judges to anchor their scoring. */
  description?: string;
}

export interface JudgeScoreRecord {
  id: number;
  judge_id: number;
  team_id: number;
  round: number;
  scores: Record<string, number>;
  comment: string | null;
  total: number;
  entered_by_email: string | null;
  submitted_at: string;
}

export interface LeaderboardAxisBreakdown {
  key: string;
  raw: number;
  weight_pct: number;
  contribution: number;
}

export interface LeaderboardPerJudge {
  judge_id: number;
  judge_name: string;
  weighted_total: number;
  axis_breakdown: LeaderboardAxisBreakdown[];
  comment: string | null;
  submitted_at: string | null;
  entered_by_email: string | null;
}

export interface LeaderboardRow {
  team_id: number;
  team_name: string;
  panel_id: number | null;
  panel_name: string | null;
  judge_count: number;
  total_sum: number;
  avg_score: number;
  per_axis_avg: Record<string, number>;
  comments: { judge_name: string; comment: string }[];
  per_judge: LeaderboardPerJudge[];
}

export interface LeaderboardData {
  round: number;
  rows: LeaderboardRow[];
}

export interface CommLogEntry {
  id: number;
  team_id: number | null;
  kind: string;
  template_id: string | null;
  subject: string | null;
  body: string | null;
  recipients: string[];
  status: string;
  sent_by_email: string | null;
  sent_at: string;
}

export interface Team {
  id: number;
  external_id: string | null;
  name: string;
  mentor_name: string | null;
  mentor_email: string | null;
  mentor_location: string | null;
  mentor_tshirt_size: string | null;
  /** Mailing address for the mentor (US/PH only). */
  mentor_address: string | null;
  idea: string | null;
  tools: string | null;
  approach: string | null;
  viability: string | null;
  business_value: string | null;
  submitted_at: string | null;
  completeness_score: number;
  flags: string[];
  members: Member[];
  ai_scores: AIScores | null;
  judge_scores: JudgeScores | null;
  repo_url: string | null;
  has_teams_channel: boolean;
  teams_channel_id: string | null;
  teams_channel_created_at: string | null;
  presentation_uploaded: boolean;
  repo_ready: boolean;
  repo_check_notes: string | null;
  advanced_to_round: number;
  final_position: number | null;
  seat_floor: string | null;
  seat_desk: string | null;
  seat_landmark: string | null;
  seat_updated_at: string | null;
  seat_updated_by: string | null;
  /** Demo presentation status (organizer-marked on Floor walk). */
  demo_status?: 'pending' | 'done' | 'no_show';
  demo_status_at?: string | null;
  demo_status_by?: string | null;
}

export interface DashboardStats {
  total_teams: number;
  complete_teams: number;
  flagged_teams: number;
  duplicate_participants: number;
  multi_team_mentors: number;
  locations: Record<string, number>;
  tshirt_sizes: Record<string, number>;
  /** Unique mentors+members deduped by email (fallback name). */
  total_unique_people: number;
}

export interface UploadResult {
  teams_imported: number;
  teams_skipped: number;
  duplicate_participants: number;
  multi_team_mentors: number;
}
