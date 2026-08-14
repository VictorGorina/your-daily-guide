export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          log_date: string;
          role: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          log_date?: string;
          role: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          log_date?: string;
          role?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      daily_logs: {
        Row: {
          created_at: string;
          evening_done: boolean;
          guide: Json | null;
          habits: Json;
          id: string;
          log_date: string;
          mood: string | null;
          notes: string | null;
          updated_at: string;
          user_id: string;
          weight_kg: number | null;
        };
        Insert: {
          created_at?: string;
          evening_done?: boolean;
          guide?: Json | null;
          habits?: Json;
          id?: string;
          log_date?: string;
          mood?: string | null;
          notes?: string | null;
          updated_at?: string;
          user_id: string;
          weight_kg?: number | null;
        };
        Update: {
          created_at?: string;
          evening_done?: boolean;
          guide?: Json | null;
          habits?: Json;
          id?: string;
          log_date?: string;
          mood?: string | null;
          notes?: string | null;
          updated_at?: string;
          user_id?: string;
          weight_kg?: number | null;
        };
        Relationships: [];
      };
      household_children: {
        Row: {
          age: number | null;
          allergies: string | null;
          appetite: string | null;
          created_at: string;
          household_id: string;
          id: string;
          name: string;
          notes: string | null;
          updated_at: string;
        };
        Insert: {
          age?: number | null;
          allergies?: string | null;
          appetite?: string | null;
          created_at?: string;
          household_id: string;
          id?: string;
          name: string;
          notes?: string | null;
          updated_at?: string;
        };
        Update: {
          age?: number | null;
          allergies?: string | null;
          appetite?: string | null;
          created_at?: string;
          household_id?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_children_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      household_members: {
        Row: {
          created_at: string;
          household_id: string;
          role: string;
          shared_meals: Json;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          household_id: string;
          role?: string;
          shared_meals?: Json;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          household_id?: string;
          role?: string;
          shared_meals?: Json;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey";
            columns: ["household_id"];
            isOneToOne: false;
            referencedRelation: "households";
            referencedColumns: ["id"];
          },
        ];
      };
      households: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          invite_code: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          invite_code: string;
          name?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          invite_code?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      monthly_plans: {
        Row: {
          confirmed_at: string | null;
          created_at: string;
          id: string;
          month: string;
          plan: Json | null;
          shopping: Json | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          confirmed_at?: string | null;
          created_at?: string;
          id?: string;
          month: string;
          plan?: Json | null;
          shopping?: Json | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          confirmed_at?: string | null;
          created_at?: string;
          id?: string;
          month?: string;
          plan?: Json | null;
          shopping?: Json | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          activity_level: string | null;
          age: number | null;
          budget_month_eur: number | null;
          coach_scope: string | null;
          created_at: string;
          current_weight_kg: number | null;
          date_of_birth: string | null;
          diet_pattern: string | null;
          display_name: string | null;
          evening_time: string;
          exercise: string | null;
          family_context: string | null;
          food_relationship: string | null;
          goal_amount: number | null;
          goal_target_date: string | null;
          goal_type: string | null;
          height_cm: number | null;
          id: string;
          life_context: string | null;
          meal_schedule: string | null;
          meals_per_day: number | null;
          medical_conditions: string | null;
          medications: string | null;
          morning_time: string;
          non_negotiable_foods: string | null;
          onboarding_completed: boolean;
          past_struggles: string | null;
          restrictions: string | null;
          sex: string | null;
          short_term_goal: string | null;
          sleep_time: string | null;
          start_weight_kg: number | null;
          theme: string;
          tone: string;
          updated_at: string;
          wake_time: string | null;
          work_schedule: string | null;
        };
        Insert: {
          activity_level?: string | null;
          age?: number | null;
          budget_month_eur?: number | null;
          coach_scope?: string | null;
          created_at?: string;
          current_weight_kg?: number | null;
          date_of_birth?: string | null;
          diet_pattern?: string | null;
          display_name?: string | null;
          evening_time?: string;
          exercise?: string | null;
          family_context?: string | null;
          food_relationship?: string | null;
          goal_amount?: number | null;
          goal_target_date?: string | null;
          goal_type?: string | null;
          height_cm?: number | null;
          id: string;
          life_context?: string | null;
          meal_schedule?: string | null;
          meals_per_day?: number | null;
          medical_conditions?: string | null;
          medications?: string | null;
          morning_time?: string;
          non_negotiable_foods?: string | null;
          onboarding_completed?: boolean;
          past_struggles?: string | null;
          restrictions?: string | null;
          sex?: string | null;
          short_term_goal?: string | null;
          sleep_time?: string | null;
          start_weight_kg?: number | null;
          theme?: string;
          tone?: string;
          updated_at?: string;
          wake_time?: string | null;
          work_schedule?: string | null;
        };
        Update: {
          activity_level?: string | null;
          age?: number | null;
          budget_month_eur?: number | null;
          coach_scope?: string | null;
          created_at?: string;
          current_weight_kg?: number | null;
          date_of_birth?: string | null;
          diet_pattern?: string | null;
          display_name?: string | null;
          evening_time?: string;
          exercise?: string | null;
          family_context?: string | null;
          food_relationship?: string | null;
          goal_amount?: number | null;
          goal_target_date?: string | null;
          goal_type?: string | null;
          height_cm?: number | null;
          id?: string;
          life_context?: string | null;
          meal_schedule?: string | null;
          meals_per_day?: number | null;
          medical_conditions?: string | null;
          medications?: string | null;
          morning_time?: string;
          non_negotiable_foods?: string | null;
          onboarding_completed?: boolean;
          past_struggles?: string | null;
          restrictions?: string | null;
          sex?: string | null;
          short_term_goal?: string | null;
          sleep_time?: string | null;
          start_weight_kg?: number | null;
          theme?: string;
          tone?: string;
          updated_at?: string;
          wake_time?: string | null;
          work_schedule?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      household_member_list: {
        Args: never;
        Returns: {
          display_name: string;
          role: string;
          shared_meals: Json;
          user_id: string;
        }[];
      };
      household_of: { Args: { _user_id: string }; Returns: string };
      is_household_member: {
        Args: { _household_id: string; _user_id: string };
        Returns: boolean;
      };
      join_household: { Args: { _invite_code: string }; Returns: string };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
