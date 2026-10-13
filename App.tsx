import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StoreProvider } from './src/data/store';
import HomeScreen from './src/screens/HomeScreen';
import SetupScreen from './src/screens/SetupScreen';
import EventScreen from './src/screens/EventScreen';
import RosterScreen from './src/screens/RosterScreen';
import PlayerScreen from './src/screens/PlayerScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import { colors } from './src/ui/theme';

export type RootStack = {
  Home: undefined;
  Setup: { eventId: string };
  Event: { eventId: string };
  Roster: undefined;
  Player: { playerId: string };
  Leaderboard: undefined;
};

const Stack = createNativeStackNavigator<RootStack>();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, text: colors.text, primary: colors.accent, border: colors.border },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <NavigationContainer theme={theme}>
          <StatusBar style="light" />
          <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text, headerShadowVisible: false }}>
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'MTG Events' }} />
            <Stack.Screen name="Setup" component={SetupScreen} options={{ title: 'New event' }} />
            <Stack.Screen name="Event" component={EventScreen} options={{ title: 'Event' }} />
            <Stack.Screen name="Roster" component={RosterScreen} options={{ title: 'Players' }} />
            <Stack.Screen name="Player" component={PlayerScreen} options={{ title: 'Player' }} />
            <Stack.Screen name="Leaderboard" component={LeaderboardScreen} options={{ title: 'Leaderboard' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
