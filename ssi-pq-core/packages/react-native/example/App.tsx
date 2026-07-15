import React, {useState} from 'react';
import {Button, SafeAreaView, ScrollView, Text, TextInput, View} from 'react-native';

import {runMinimalFlow} from './minimal-flow';

export default function App() {
  const [inputPdfUri, setInputPdfUri] = useState('file:///path/to/input.pdf');
  const [outputPdfUri, setOutputPdfUri] = useState('file:///path/to/output.pdf');
  const [status, setStatus] = useState('Ready');

  async function run() {
    setStatus('Running...');
    try {
      const result = await runMinimalFlow({
        walletName: 'rn-example-wallet',
        password: 'change-me-in-product',
        inputPdfUri,
        outputPdfUri,
      });
      setStatus(JSON.stringify(result.verification, null, 2));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <SafeAreaView>
      <ScrollView contentInsetAdjustmentBehavior="automatic">
        <View style={{gap: 12, padding: 16}}>
          <Text>SSI-PQ React Native minimal flow</Text>
          <TextInput value={inputPdfUri} onChangeText={setInputPdfUri} autoCapitalize="none" />
          <TextInput value={outputPdfUri} onChangeText={setOutputPdfUri} autoCapitalize="none" />
          <Button title="Run wallet/PDF flow" onPress={run} />
          <Text>{status}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
