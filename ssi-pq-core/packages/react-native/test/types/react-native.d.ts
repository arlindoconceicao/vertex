declare module 'react-native' {
  export interface TurboModule {}

  export const TurboModuleRegistry: {
    getEnforcing<T>(name: string): T;
  };
}
