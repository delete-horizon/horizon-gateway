/**
 * Supabase Database types.
 *
 * Prefer regenerating from a running local stack:
 *   pnpm supabase:types
 *
 * This checked-in file mirrors `supabase/migrations/*` so typecheck works
 * without Docker. Re-run `supabase:types` after schema changes and commit.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          display_name: string | null;
          avatar_url: string | null;
          is_sponsor: boolean;
          sponsor_tier: string | null;
          created_at: string;
          github_id: string | null;
          github_login: string | null;
          sponsor_since: string | null;
          team_entitlement: "pro" | "unlimited" | null;
        };
        Insert: {
          id: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          is_sponsor?: boolean;
          sponsor_tier?: string | null;
          created_at?: string;
          github_id?: string | null;
          github_login?: string | null;
          sponsor_since?: string | null;
          team_entitlement?: "pro" | "unlimited" | null;
        };
        Update: {
          id?: string;
          email?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          is_sponsor?: boolean;
          sponsor_tier?: string | null;
          created_at?: string;
          github_id?: string | null;
          github_login?: string | null;
          sponsor_since?: string | null;
          team_entitlement?: "pro" | "unlimited" | null;
        };
        Relationships: [];
      };
      feedbacks: {
        Row: {
          id: string;
          profile_id: string | null;
          content: string;
          created_at: string;
          category: string | null;
          app_version: string | null;
          os: string | null;
          install_id: string | null;
          context: string | null;
        };
        Insert: {
          id?: string;
          profile_id?: string | null;
          content?: string;
          created_at?: string;
          category?: string | null;
          app_version?: string | null;
          os?: string | null;
          install_id?: string | null;
          context?: string | null;
        };
        Update: {
          id?: string;
          profile_id?: string | null;
          content?: string;
          created_at?: string;
          category?: string | null;
          app_version?: string | null;
          os?: string | null;
          install_id?: string | null;
          context?: string | null;
        };
        Relationships: [];
      };
      events: {
        Row: {
          id: number;
          install_id: string;
          app_version: string | null;
          os: string | null;
          event: string;
          props: Json;
          ts: string;
        };
        Insert: {
          id?: number;
          install_id: string;
          app_version?: string | null;
          os?: string | null;
          event: string;
          props?: Json;
          ts?: string;
        };
        Update: {
          id?: number;
          install_id?: string;
          app_version?: string | null;
          os?: string | null;
          event?: string;
          props?: Json;
          ts?: string;
        };
        Relationships: [];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          seat_limit: number;
          status: string;
          created_at: string;
          plan: string;
          ls_subscription_id: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          owner_id: string;
          seat_limit?: number;
          status?: string;
          created_at?: string;
          plan?: string;
          ls_subscription_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          owner_id?: string;
          seat_limit?: number;
          status?: string;
          created_at?: string;
          plan?: string;
          ls_subscription_id?: string | null;
        };
        Relationships: [];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          profile_id: string;
          role: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          profile_id: string;
          role?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          profile_id?: string;
          role?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_invites: {
        Row: {
          id: string;
          workspace_id: string;
          email: string;
          role: string;
          status: string;
          invited_by: string | null;
          token: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          email: string;
          role?: string;
          status?: string;
          invited_by?: string | null;
          token?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          email?: string;
          role?: string;
          status?: string;
          invited_by?: string | null;
          token?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_invites_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_resources: {
        Row: {
          id: string;
          workspace_id: string;
          kind: string;
          payload: Json;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          kind: string;
          payload?: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          kind?: string;
          payload?: Json;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      device_keys: {
        Row: {
          profile_id: string;
          device_id: string;
          x25519_public: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          device_id: string;
          x25519_public: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          device_id?: string;
          x25519_public?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      peer_sessions: {
        Row: {
          workspace_id: string;
          profile_id: string;
          device_id: string;
          lan_hosts: Json;
          lan_port: number;
          tunnel_url: string | null;
          is_host: boolean;
          updated_at: string;
        };
        Insert: {
          workspace_id: string;
          profile_id: string;
          device_id: string;
          lan_hosts?: Json;
          lan_port?: number;
          tunnel_url?: string | null;
          is_host?: boolean;
          updated_at?: string;
        };
        Update: {
          workspace_id?: string;
          profile_id?: string;
          device_id?: string;
          lan_hosts?: Json;
          lan_port?: number;
          tunnel_url?: string | null;
          is_host?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      chat_rooms: {
        Row: {
          id: string;
          workspace_id: string;
          kind: string;
          name: string | null;
          host_profile_id: string | null;
          member_ids: Json;
          created_at: string;
        };
        Insert: {
          id: string;
          workspace_id: string;
          kind: string;
          name?: string | null;
          host_profile_id?: string | null;
          member_ids?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          kind?: string;
          name?: string | null;
          host_profile_id?: string | null;
          member_ids?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      avatar_user_parts: {
        Row: {
          id: string;
          owner_id: string;
          slot: string;
          slug: string;
          ko: string;
          en: string;
          set_key: string;
          shop: boolean;
          glyphs: Json;
          copied_from: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          slot: string;
          slug?: string;
          ko?: string;
          en?: string;
          set_key?: string;
          shop?: boolean;
          glyphs: Json;
          copied_from?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          slot?: string;
          slug?: string;
          ko?: string;
          en?: string;
          set_key?: string;
          shop?: boolean;
          glyphs?: Json;
          copied_from?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      avatar_owned: {
        Row: {
          id: string;
          owner_id: string;
          name_ko: string;
          name_en: string;
          body_ref: string;
          head_ref: string;
          outfit_ref: string;
          back_ref: string;
          held_ref: string;
          palette: string;
          copied_from: string | null;
          visibility: string;
          listed_for_sale: boolean;
          price_cents: number | null;
          revision: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name_ko?: string;
          name_en?: string;
          body_ref: string;
          head_ref: string;
          outfit_ref: string;
          back_ref: string;
          held_ref: string;
          palette?: string;
          copied_from?: string | null;
          visibility?: string;
          listed_for_sale?: boolean;
          price_cents?: number | null;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          name_ko?: string;
          name_en?: string;
          body_ref?: string;
          head_ref?: string;
          outfit_ref?: string;
          back_ref?: string;
          held_ref?: string;
          palette?: string;
          copied_from?: string | null;
          visibility?: string;
          listed_for_sale?: boolean;
          price_cents?: number | null;
          revision?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      avatar_entitlements: {
        Row: {
          id: string;
          avatar_id: string;
          buyer_id: string;
          revision: number;
          snapshot: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          avatar_id: string;
          buyer_id: string;
          revision: number;
          snapshot: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          avatar_id?: string;
          buyer_id?: string;
          revision?: number;
          snapshot?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_workspace_member: { Args: { ws_id: string }; Returns: boolean };
      is_workspace_admin: { Args: { ws_id: string }; Returns: boolean };
      shares_workspace_with: { Args: { target_profile: string }; Returns: boolean };
      avatar_author_name: { Args: { target: string }; Returns: string };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Row"];
