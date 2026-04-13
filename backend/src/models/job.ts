export interface ConversationRow {
  id: string;
  created_at: Date;
  updated_at: Date;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  tools_used: string[] | null;
  created_at: Date;
}

export interface JobRow {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'failed' | 'completed';
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export type TimeRange = '1h' | '24h' | '7d' | '30d';
export type CostTimeRange = '7d' | '30d' | '90d';
export type CostGroupBy = 'SERVICE' | 'REGION' | 'USAGE_TYPE';

export interface RedisStats {
  hit_rate: number;
  memory_used_mb: number;
  connected_clients: number;
  total_commands_processed: number;
  keyspace_hits: number;
  keyspace_misses: number;
  uptime_seconds: number;
}

export interface AwsCostEntry {
  service: string;
  amount: number;
  currency: string;
  period_start: string;
  period_end: string;
}
