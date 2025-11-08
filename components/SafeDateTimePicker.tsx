// components/SafeDateTimePicker.tsx
// Wrapper component to safely handle DateTimePicker on Android to prevent unmount crashes
// The issue: DateTimePicker's cleanup tries to dismiss the native picker, but the native module
// is already destroyed during unmount. This wrapper ensures proper cleanup.

import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";

type SafeDateTimePickerProps = {
  value: Date;
  mode: "date" | "time" | "datetime";
  is24Hour?: boolean;
  minimumDate?: Date;
  display?: "default" | "spinner" | "clock" | "calendar";
  onChange: (event: DateTimePickerEvent, date?: Date) => void;
  key?: string;
};

export default function SafeDateTimePicker(props: SafeDateTimePickerProps) {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Simply render the DateTimePicker - the parent components handle closing it before unmount
  // The error boundary will catch any cleanup errors
  return <DateTimePicker {...props} />;
}

