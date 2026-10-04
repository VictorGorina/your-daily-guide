// Generado por `bun run db:types` a partir del esquema de producción: no se edita a mano.
// Tras una migración se regenera; la copia del móvil es mobile/lib/database.types.ts.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      ai_spend: {
        Row: {
          calls: number;
          cost_usd: number;
          day: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          calls?: number;
          cost_usd?: number;
          day: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          calls?: number;
          cost_usd?: number;
          day?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
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
          adjustment: Json | null;
          created_at: string;
          evening_done: boolean;
          exercise: Json | null;
          guide: Json | null;
          habits: Json;
          id: string;
          log_date: string;
          mood: string | null;
          notes: string | null;
          snacks: Json | null;
          updated_at: string;
          user_id: string;
          weight_kg: number | null;
        };
        Insert: {
          adjustment?: Json | null;
          created_at?: string;
          evening_done?: boolean;
          exercise?: Json | null;
          guide?: Json | null;
          habits?: Json;
          id?: string;
          log_date?: string;
          mood?: string | null;
          notes?: string | null;
          snacks?: Json | null;
          updated_at?: string;
          user_id: string;
          weight_kg?: number | null;
        };
        Update: {
          adjustment?: Json | null;
          created_at?: string;
          evening_done?: boolean;
          exercise?: Json | null;
          guide?: Json | null;
          habits?: Json;
          id?: string;
          log_date?: string;
          mood?: string | null;
          notes?: string | null;
          snacks?: Json | null;
          updated_at?: string;
          user_id?: string;
          weight_kg?: number | null;
        };
        Relationships: [];
      };
      dish_recipes: {
        Row: {
          agreement: number | null;
          created_at: string;
          dish_key: string;
          dish_label: string;
          flags: string[];
          foods_version: string;
          hits: number;
          ingredients: Json;
          judged: boolean;
          methods: string[];
          pipeline_version: number;
          quality: number;
          reviewed: boolean;
          serving_kind: string;
          sources: string[];
          text_quantity: number | null;
          unit_label: string | null;
          updated_at: string;
        };
        Insert: {
          agreement?: number | null;
          created_at?: string;
          dish_key: string;
          dish_label: string;
          flags?: string[];
          foods_version: string;
          hits?: number;
          ingredients: Json;
          judged?: boolean;
          methods?: string[];
          pipeline_version: number;
          quality: number;
          reviewed?: boolean;
          serving_kind?: string;
          sources?: string[];
          text_quantity?: number | null;
          unit_label?: string | null;
          updated_at?: string;
        };
        Update: {
          agreement?: number | null;
          created_at?: string;
          dish_key?: string;
          dish_label?: string;
          flags?: string[];
          foods_version?: string;
          hits?: number;
          ingredients?: Json;
          judged?: boolean;
          methods?: string[];
          pipeline_version?: number;
          quality?: number;
          reviewed?: boolean;
          serving_kind?: string;
          sources?: string[];
          text_quantity?: number | null;
          unit_label?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      foods_extra: {
        Row: {
          aliases: string[];
          carbs_g: number;
          category: string;
          created_at: string;
          fat_g: number;
          fiber_g: number;
          hits: number;
          kcal: number;
          key: string;
          label: string;
          protein_g: number;
          reviewed: boolean;
          source: string;
          source_id: string;
          source_label: string | null;
        };
        Insert: {
          aliases?: string[];
          carbs_g: number;
          category: string;
          created_at?: string;
          fat_g: number;
          fiber_g?: number;
          hits?: number;
          kcal: number;
          key: string;
          label: string;
          protein_g: number;
          reviewed?: boolean;
          source?: string;
          source_id: string;
          source_label?: string | null;
        };
        Update: {
          aliases?: string[];
          carbs_g?: number;
          category?: string;
          created_at?: string;
          fat_g?: number;
          fiber_g?: number;
          hits?: number;
          kcal?: number;
          key?: string;
          label?: string;
          protein_g?: number;
          reviewed?: boolean;
          source?: string;
          source_id?: string;
          source_label?: string | null;
        };
        Relationships: [];
      };
      household_children: {
        Row: {
          age: number | null;
          allergies: string | null;
          appetite: string | null;
          created_at: string;
          feeding_stage: string;
          home_schedule: Json | null;
          household_id: string;
          id: string;
          name: string;
          notes: string | null;
          portion: number;
          updated_at: string;
        };
        Insert: {
          age?: number | null;
          allergies?: string | null;
          appetite?: string | null;
          created_at?: string;
          feeding_stage?: string;
          home_schedule?: Json | null;
          household_id: string;
          id?: string;
          name: string;
          notes?: string | null;
          portion?: number;
          updated_at?: string;
        };
        Update: {
          age?: number | null;
          allergies?: string | null;
          appetite?: string | null;
          created_at?: string;
          feeding_stage?: string;
          home_schedule?: Json | null;
          household_id?: string;
          id?: string;
          name?: string;
          notes?: string | null;
          portion?: number;
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
          display_name: string;
          home_schedule: Json | null;
          household_id: string;
          id: string;
          is_planner: boolean;
          portion: number;
          role: string;
          updated_at: string;
          user_id: string | null;
          uses_app: boolean;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          home_schedule?: Json | null;
          household_id: string;
          id?: string;
          is_planner?: boolean;
          portion?: number;
          role?: string;
          updated_at?: string;
          user_id?: string | null;
          uses_app?: boolean;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          home_schedule?: Json | null;
          household_id?: string;
          id?: string;
          is_planner?: boolean;
          portion?: number;
          role?: string;
          updated_at?: string;
          user_id?: string | null;
          uses_app?: boolean;
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
          created_by: string | null;
          goal_budget_eur: number | null;
          goal_text: string | null;
          goal_type: string | null;
          id: string;
          invite_code: string;
          name: string;
          shared_slots: Json;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          goal_budget_eur?: number | null;
          goal_text?: string | null;
          goal_type?: string | null;
          id?: string;
          invite_code: string;
          name?: string;
          shared_slots?: Json;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          goal_budget_eur?: number | null;
          goal_text?: string | null;
          goal_type?: string | null;
          id?: string;
          invite_code?: string;
          name?: string;
          shared_slots?: Json;
          updated_at?: string;
        };
        Relationships: [];
      };
      join_attempts: {
        Row: {
          attempts: number;
          user_id: string;
          window_start: string;
        };
        Insert: {
          attempts?: number;
          user_id: string;
          window_start?: string;
        };
        Update: {
          attempts?: number;
          user_id?: string;
          window_start?: string;
        };
        Relationships: [];
      };
      month_constraints: {
        Row: {
          away_end: string | null;
          away_start: string | null;
          created_at: string;
          id: string;
          month: string;
          notes: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          away_end?: string | null;
          away_start?: string | null;
          created_at?: string;
          id?: string;
          month: string;
          notes?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          away_end?: string | null;
          away_start?: string | null;
          created_at?: string;
          id?: string;
          month?: string;
          notes?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      monthly_plans: {
        Row: {
          confirmed_at: string | null;
          confirmed_trips: Json | null;
          created_at: string;
          id: string;
          month: string;
          pantry_extras: Json | null;
          plan: Json | null;
          shopping: Json | null;
          trip_actuals: Json | null;
          trip_receipts: Json | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          confirmed_at?: string | null;
          confirmed_trips?: Json | null;
          created_at?: string;
          id?: string;
          month: string;
          pantry_extras?: Json | null;
          plan?: Json | null;
          shopping?: Json | null;
          trip_actuals?: Json | null;
          trip_receipts?: Json | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          confirmed_at?: string | null;
          confirmed_trips?: Json | null;
          created_at?: string;
          id?: string;
          month?: string;
          pantry_extras?: Json | null;
          plan?: Json | null;
          shopping?: Json | null;
          trip_actuals?: Json | null;
          trip_receipts?: Json | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          activity_level: string | null;
          age: number | null;
          alcohol: string | null;
          allergy_severity: string | null;
          app_started_on: string | null;
          budget_month_eur: number | null;
          coach_scope: string | null;
          cooking_skill: string | null;
          country: string | null;
          created_at: string;
          cuisine_preference: string | null;
          currency: string;
          current_weight_kg: number | null;
          daily_activity: string | null;
          date_of_birth: string | null;
          diet_pattern: string | null;
          disliked_foods: string | null;
          display_name: string | null;
          ed_history: string | null;
          evening_push_sent_on: string | null;
          evening_time: string;
          exercise: string | null;
          family_context: string | null;
          food_relationship: string | null;
          goal_amount: number | null;
          goal_target_date: string | null;
          goal_type: string | null;
          height_cm: number | null;
          id: string;
          kitchen_equipment: string | null;
          life_context: string | null;
          locale: string;
          meal_schedule: string | null;
          meal_slots: string[] | null;
          meals_per_day: number | null;
          meals_to_plan: string | null;
          medical_conditions: string | null;
          medications: string | null;
          menstrual_cycle: string | null;
          morning_push_sent_on: string | null;
          morning_time: string;
          non_negotiable_foods: string | null;
          nutrition_numbers: string;
          onboarding_completed: boolean;
          past_struggles: string | null;
          plan_renewal_push_sent_on: string | null;
          portions_per_meal: string | null;
          pregnancy_status: string | null;
          restrictions: string | null;
          sex: string | null;
          short_term_goal: string | null;
          sleep_time: string | null;
          smoking: string | null;
          start_weight_kg: number | null;
          strength_training_experience: string | null;
          supplements: string | null;
          target_weight_kg: number | null;
          theme: string;
          timezone: string;
          tone: string;
          tracking_experience: string | null;
          training: string | null;
          updated_at: string;
          wake_time: string | null;
          weigh_in_cadence: string | null;
          work_schedule: string | null;
        };
        Insert: {
          activity_level?: string | null;
          age?: number | null;
          alcohol?: string | null;
          allergy_severity?: string | null;
          app_started_on?: string | null;
          budget_month_eur?: number | null;
          coach_scope?: string | null;
          cooking_skill?: string | null;
          country?: string | null;
          created_at?: string;
          cuisine_preference?: string | null;
          currency?: string;
          current_weight_kg?: number | null;
          daily_activity?: string | null;
          date_of_birth?: string | null;
          diet_pattern?: string | null;
          disliked_foods?: string | null;
          display_name?: string | null;
          ed_history?: string | null;
          evening_push_sent_on?: string | null;
          evening_time?: string;
          exercise?: string | null;
          family_context?: string | null;
          food_relationship?: string | null;
          goal_amount?: number | null;
          goal_target_date?: string | null;
          goal_type?: string | null;
          height_cm?: number | null;
          id: string;
          kitchen_equipment?: string | null;
          life_context?: string | null;
          locale?: string;
          meal_schedule?: string | null;
          meal_slots?: string[] | null;
          meals_per_day?: number | null;
          meals_to_plan?: string | null;
          medical_conditions?: string | null;
          medications?: string | null;
          menstrual_cycle?: string | null;
          morning_push_sent_on?: string | null;
          morning_time?: string;
          non_negotiable_foods?: string | null;
          nutrition_numbers?: string;
          onboarding_completed?: boolean;
          past_struggles?: string | null;
          plan_renewal_push_sent_on?: string | null;
          portions_per_meal?: string | null;
          pregnancy_status?: string | null;
          restrictions?: string | null;
          sex?: string | null;
          short_term_goal?: string | null;
          sleep_time?: string | null;
          smoking?: string | null;
          start_weight_kg?: number | null;
          strength_training_experience?: string | null;
          supplements?: string | null;
          target_weight_kg?: number | null;
          theme?: string;
          timezone?: string;
          tone?: string;
          tracking_experience?: string | null;
          training?: string | null;
          updated_at?: string;
          wake_time?: string | null;
          weigh_in_cadence?: string | null;
          work_schedule?: string | null;
        };
        Update: {
          activity_level?: string | null;
          age?: number | null;
          alcohol?: string | null;
          allergy_severity?: string | null;
          app_started_on?: string | null;
          budget_month_eur?: number | null;
          coach_scope?: string | null;
          cooking_skill?: string | null;
          country?: string | null;
          created_at?: string;
          cuisine_preference?: string | null;
          currency?: string;
          current_weight_kg?: number | null;
          daily_activity?: string | null;
          date_of_birth?: string | null;
          diet_pattern?: string | null;
          disliked_foods?: string | null;
          display_name?: string | null;
          ed_history?: string | null;
          evening_push_sent_on?: string | null;
          evening_time?: string;
          exercise?: string | null;
          family_context?: string | null;
          food_relationship?: string | null;
          goal_amount?: number | null;
          goal_target_date?: string | null;
          goal_type?: string | null;
          height_cm?: number | null;
          id?: string;
          kitchen_equipment?: string | null;
          life_context?: string | null;
          locale?: string;
          meal_schedule?: string | null;
          meal_slots?: string[] | null;
          meals_per_day?: number | null;
          meals_to_plan?: string | null;
          medical_conditions?: string | null;
          medications?: string | null;
          menstrual_cycle?: string | null;
          morning_push_sent_on?: string | null;
          morning_time?: string;
          non_negotiable_foods?: string | null;
          nutrition_numbers?: string;
          onboarding_completed?: boolean;
          past_struggles?: string | null;
          plan_renewal_push_sent_on?: string | null;
          portions_per_meal?: string | null;
          pregnancy_status?: string | null;
          restrictions?: string | null;
          sex?: string | null;
          short_term_goal?: string | null;
          sleep_time?: string | null;
          smoking?: string | null;
          start_weight_kg?: number | null;
          strength_training_experience?: string | null;
          supplements?: string | null;
          target_weight_kg?: number | null;
          theme?: string;
          timezone?: string;
          tone?: string;
          tracking_experience?: string | null;
          training?: string | null;
          updated_at?: string;
          wake_time?: string | null;
          weigh_in_cadence?: string | null;
          work_schedule?: string | null;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          p256dh: string;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          p256dh: string;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          p256dh?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      rate_limits: {
        Row: {
          attempts: number;
          bucket: string;
          subject: string;
          window_start: string;
        };
        Insert: {
          attempts?: number;
          bucket: string;
          subject: string;
          window_start?: string;
        };
        Update: {
          attempts?: number;
          bucket?: string;
          subject?: string;
          window_start?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      ai_spend_total_today: { Args: never; Returns: number };
      claim_household_slot: {
        Args: { _invite_code: string; _member_id: string };
        Returns: string;
      };
      consume_rate_limit: {
        Args: {
          _bucket: string;
          _limit: number;
          _subject: string;
          _window_seconds: number;
        };
        Returns: {
          allowed: boolean;
          retry_after_seconds: number;
        }[];
      };
      due_push_profiles: {
        Args: { _window_minutes?: number };
        Returns: {
          id: string;
          kind: string;
          push_day: string;
        }[];
      };
      due_push_profiles_at: {
        Args: { _now: string; _window_minutes?: number };
        Returns: {
          id: string;
          kind: string;
          push_day: string;
        }[];
      };
      household_assign_oldest_planner: {
        Args: { _household_id: string };
        Returns: undefined;
      };
      household_is_empty: { Args: { _household_id: string }; Returns: boolean };
      household_member_list: {
        Args: never;
        Returns: {
          display_name: string;
          home_schedule: Json;
          id: string;
          is_planner: boolean;
          portion: number;
          role: string;
          user_id: string;
          uses_app: boolean;
        }[];
      };
      household_of: { Args: { _user_id: string }; Returns: string };
      household_open_slots: {
        Args: { _invite_code: string };
        Returns: {
          display_name: string;
          id: string;
        }[];
      };
      household_plan_context: {
        Args: { _user_id: string };
        Returns: {
          planner_id: string;
          shared_slots: Json;
        }[];
      };
      household_planner_of: { Args: { _user_id: string }; Returns: string };
      increment_dish_recipe_hits: {
        Args: { _by?: number; _keys: string[] };
        Returns: undefined;
      };
      is_household_member: {
        Args: { _household_id: string; _user_id: string };
        Returns: boolean;
      };
      is_household_planner: {
        Args: { _household_id: string; _user_id: string };
        Returns: boolean;
      };
      join_household: { Args: { _invite_code: string }; Returns: string };
      record_ai_spend: {
        Args: { _cost_usd: number; _user_id: string };
        Returns: undefined;
      };
      set_household_planner: {
        Args: { _household_id: string; _member_id: string };
        Returns: undefined;
      };
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
