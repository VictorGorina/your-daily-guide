import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useAuth } from "../lib/auth-context";

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator color="#6dbe7b" />
      </View>
    );
  }

  return <Redirect href={session ? "/hoy" : "/auth"} />;
}
