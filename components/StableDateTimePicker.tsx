// components/StableDateTimePicker.tsx
// Stable cross-platform date/time picker with comprehensive error handling
// If native picker fails, falls back to a simple custom picker

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Platform, View, Modal, TouchableOpacity, Text, StyleSheet, ScrollView } from "react-native";
import { COLORS } from "../lib/theme";

type StableDateTimePickerProps = {
  visible: boolean;
  value: Date;
  mode: "date" | "time" | "datetime";
  minimumDate?: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
};

// Custom picker component that doesn't rely on native modules
function CustomDateTimePicker({
  visible,
  value,
  mode,
  minimumDate,
  onConfirm,
  onCancel,
}: StableDateTimePickerProps) {
  const [selectedDate, setSelectedDate] = useState(value);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (visible) {
      setSelectedDate(value);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [visible, value]);

  // Generate date options
  const dateOptions = useMemo(() => {
    const options: { label: string; value: Date }[] = [];
    const start = minimumDate || new Date();
    const end = new Date();
    end.setFullYear(end.getFullYear() + 1);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      options.push({
        label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
        value: new Date(d),
      });
    }
    return options;
  }, [minimumDate]);

  // Generate time options (every 15 minutes)
  const timeOptions = useMemo(() => {
    const options: { label: string; value: Date }[] = [];
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const date = new Date();
        date.setHours(hour, minute, 0, 0);
        const timeStr = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
        options.push({ label: timeStr, value: date });
      }
    }
    return options;
  }, []);

  const handleConfirm = () => {
    if (mountedRef.current) {
      onConfirm(selectedDate);
    }
  };

  const handleCancel = () => {
    if (mountedRef.current) {
      onCancel();
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleCancel} />
        <View style={styles.modalContent}>
          <Text style={styles.title}>
            {mode === "date" ? "Select Date" : mode === "time" ? "Select Time" : "Select Date & Time"}
          </Text>

          {mode === "date" || mode === "datetime" ? (
            <View style={styles.pickerContainer}>
              <Text style={styles.label}>Date</Text>
              <ScrollView style={styles.scrollPicker} showsVerticalScrollIndicator={false}>
                {dateOptions.map((option, index) => {
                  const isSelected = option.value.toDateString() === selectedDate.toDateString();
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[styles.option, isSelected && styles.selectedOption]}
                      onPress={() => setSelectedDate(option.value)}
                    >
                      <Text style={[styles.optionText, isSelected && styles.selectedOptionText]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {mode === "time" || mode === "datetime" ? (
            <View style={styles.pickerContainer}>
              <Text style={styles.label}>Time</Text>
              <ScrollView style={styles.scrollPicker} showsVerticalScrollIndicator={false}>
                {timeOptions.map((option, index) => {
                  const selectedTime = `${selectedDate.getHours().toString().padStart(2, "0")}:${selectedDate.getMinutes().toString().padStart(2, "0")}`;
                  const optionTime = `${option.value.getHours().toString().padStart(2, "0")}:${option.value.getMinutes().toString().padStart(2, "0")}`;
                  const isSelected = selectedTime === optionTime;
                  return (
                    <TouchableOpacity
                      key={index}
                      style={[styles.option, isSelected && styles.selectedOption]}
                      onPress={() => {
                        const newDate = new Date(selectedDate);
                        newDate.setHours(option.value.getHours(), option.value.getMinutes());
                        setSelectedDate(newDate);
                      }}
                    >
                      <Text style={[styles.optionText, isSelected && styles.selectedOptionText]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.button} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.confirmButton]} onPress={handleConfirm}>
              <Text style={styles.confirmButtonText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Main component with error boundary
export default function StableDateTimePicker(props: StableDateTimePickerProps) {
  const [useCustomPicker, setUseCustomPicker] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Try to use native picker first, fall back to custom if it fails
  useEffect(() => {
    if (props.visible && !useCustomPicker) {
      // Test if native picker is available
      try {
        const DateTimePicker = require("@react-native-community/datetimepicker").default;
        if (!DateTimePicker) {
          setUseCustomPicker(true);
        }
      } catch (error) {
        setUseCustomPicker(true);
      }
    }
  }, [props.visible, useCustomPicker]);

  // If we've had errors or custom picker is forced, use custom
  if (useCustomPicker || hasError) {
    return <CustomDateTimePicker {...props} />;
  }

  // Try native picker with error boundary
  try {
    const DateTimePicker = require("@react-native-community/datetimepicker").default;
    return <NativeDateTimePicker {...props} onError={() => setHasError(true)} />;
  } catch (error) {
    return <CustomDateTimePicker {...props} />;
  }
}

// Native picker wrapper with error handling
function NativeDateTimePicker({
  visible,
  value,
  mode,
  minimumDate,
  onConfirm,
  onCancel,
  onError,
}: StableDateTimePickerProps & { onError: () => void }) {
  const [internalDate, setInternalDate] = useState(value);
  const mountedRef = useRef(true);

  const safeValue = value instanceof Date && !isNaN(value.getTime()) ? value : new Date();

  useEffect(() => {
    mountedRef.current = true;
    if (visible) {
      setInternalDate(safeValue);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [visible, safeValue]);

  const handleChange = (event: any, selectedDate?: Date) => {
    try {
      if (selectedDate && mountedRef.current) {
        setInternalDate(selectedDate);
      }
    } catch (error) {
      console.warn("[NativeDateTimePicker] Error in handleChange:", error);
      onError();
    }
  };

  const handleConfirm = () => {
    if (mountedRef.current) {
      onConfirm(internalDate);
    }
  };

  const handleCancel = () => {
    if (mountedRef.current) {
      onCancel();
    }
  };

  if (!visible) return null;

  try {
    const DateTimePicker = require("@react-native-community/datetimepicker").default;
    
    return (
      <Modal
        visible={visible}
        transparent={true}
        animationType="slide"
        onRequestClose={handleCancel}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleCancel} />
          <View style={styles.modalContent}>
            <DateTimePicker
              value={internalDate}
              mode={mode}
              display="spinner"
              minimumDate={minimumDate}
              onChange={handleChange}
              style={styles.picker}
              textColor={COLORS.text}
              themeVariant="dark"
            />
            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.button} onPress={handleCancel}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.button, styles.confirmButton]} onPress={handleConfirm}>
                <Text style={styles.confirmButtonText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  } catch (error) {
    console.warn("[NativeDateTimePicker] Failed to render native picker:", error);
    onError();
    return null;
  }
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    width: "90%",
    maxWidth: 400,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: "80%",
  },
  title: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 16,
  },
  pickerContainer: {
    width: "100%",
    marginBottom: 16,
  },
  label: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
  },
  scrollPicker: {
    maxHeight: 200,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  selectedOption: {
    backgroundColor: `${COLORS.accent}26`,
  },
  optionText: {
    color: COLORS.text,
    fontSize: 16,
  },
  selectedOptionText: {
    color: COLORS.accent,
    fontWeight: "700",
  },
  picker: {
    width: "100%",
    height: Platform.OS === "android" ? 180 : 200,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 20,
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  confirmButton: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  cancelButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "600",
  },
  confirmButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "700",
  },
});
