package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestValidateCalendarMappingField(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "template", Type: av.KeyTypeTemplate}},
			{Key: &av.Key{ID: "select", Type: av.KeyTypeSelect}},
			{Key: &av.Key{ID: "mSelect", Type: av.KeyTypeMSelect}},
			{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}},
		},
	}

	if err := validateCalendarMappingField(attrView, "", "empty", av.KeyTypeText); nil != err {
		t.Fatalf("empty field should clear mapping without error: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "text", "recurrenceFieldID", av.KeyTypeText, av.KeyTypeTemplate); nil != err {
		t.Fatalf("text field should be accepted: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "template", "descriptionFieldID", av.KeyTypeText, av.KeyTypeTemplate); nil != err {
		t.Fatalf("template field should be accepted: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "select", "colorFieldID", av.KeyTypeSelect, av.KeyTypeMSelect); nil != err {
		t.Fatalf("select field should be accepted for color mapping: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "mSelect", "colorFieldID", av.KeyTypeSelect, av.KeyTypeMSelect); nil != err {
		t.Fatalf("mSelect field should be accepted for color mapping: %v", err)
	}
	if err := validateCalendarMappingField(attrView, "date", "colorFieldID", av.KeyTypeSelect, av.KeyTypeMSelect); nil == err {
		t.Fatal("date field should be rejected for color mapping")
	}
	if err := validateCalendarMappingField(attrView, "missing", "locationFieldID", av.KeyTypeText); nil == err {
		t.Fatal("missing field should be rejected")
	}
}

func TestCalendarDateFieldFromOperationData(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "date", Type: av.KeyTypeDate}},
			{Key: &av.Key{ID: "text", Type: av.KeyTypeText}},
		},
	}

	dateFieldID, err := calendarDateFieldFromOperationData(attrView, &Operation{KeyID: "date"})
	if err != nil {
		t.Fatalf("date keyID should be accepted: %v", err)
	}
	if dateFieldID != "date" {
		t.Fatalf("expected date field from keyID, got %s", dateFieldID)
	}

	dateFieldID, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: "date"})
	if err != nil {
		t.Fatalf("date data should be accepted: %v", err)
	}
	if dateFieldID != "date" {
		t.Fatalf("expected date field from data, got %s", dateFieldID)
	}

	dateFieldID, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: ""})
	if err != nil {
		t.Fatalf("empty data should clear date field without error: %v", err)
	}
	if dateFieldID != "" {
		t.Fatalf("expected empty date field, got %s", dateFieldID)
	}

	if _, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: float64(1)}); err == nil {
		t.Fatal("non-string data should be rejected")
	}
	if _, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: "text"}); err == nil {
		t.Fatal("non-date field should be rejected")
	}
	if _, err = calendarDateFieldFromOperationData(attrView, &Operation{Data: "missing"}); err == nil {
		t.Fatal("missing field should be rejected")
	}
}

func TestValidateCalendarFieldMappingUnique(t *testing.T) {
	if err := validateCalendarFieldMappingUnique(nil); err != nil {
		t.Fatalf("nil mapping should be accepted: %v", err)
	}
	if err := validateCalendarFieldMappingUnique(&av.CalendarFieldMapping{
		RecurrenceFieldID:  "recurrence",
		ExceptionFieldID:   "exception",
		LocationFieldID:    "location",
		DescriptionFieldID: "description",
		ColorFieldID:       "recurrence",
	}); err != nil {
		t.Fatalf("color mapping may reuse text metadata field IDs because it has a different key type: %v", err)
	}
	if err := validateCalendarFieldMappingUnique(&av.CalendarFieldMapping{
		RecurrenceFieldID: "metadata",
		ExceptionFieldID:  "metadata",
	}); err == nil {
		t.Fatal("duplicate text metadata fields should be rejected")
	}
}

func TestCalendarFieldMappingFromOperationDataMergesExisting(t *testing.T) {
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{
			{Key: &av.Key{ID: "recurrence", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "exception", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "location", Type: av.KeyTypeText}},
			{Key: &av.Key{ID: "description", Type: av.KeyTypeTemplate}},
			{Key: &av.Key{ID: "color", Type: av.KeyTypeSelect}},
			{Key: &av.Key{ID: "newColor", Type: av.KeyTypeMSelect}},
		},
	}
	existing := &av.CalendarFieldMapping{
		RecurrenceFieldID:  "recurrence",
		ExceptionFieldID:   "exception",
		LocationFieldID:    "location",
		DescriptionFieldID: "description",
		ColorFieldID:       "color",
	}

	mapping, err := calendarFieldMappingFromOperationData(attrView, existing, map[string]any{
		"colorFieldID": "newColor",
	})
	if err != nil {
		t.Fatalf("partial mapping update should be accepted: %v", err)
	}
	if mapping.RecurrenceFieldID != "recurrence" || mapping.ExceptionFieldID != "exception" ||
		mapping.LocationFieldID != "location" || mapping.DescriptionFieldID != "description" ||
		mapping.ColorFieldID != "newColor" {
		t.Fatalf("partial update should preserve existing mapping fields: %#v", mapping)
	}

	mapping, err = calendarFieldMappingFromOperationData(attrView, existing, map[string]any{
		"locationFieldID": "",
	})
	if err != nil {
		t.Fatalf("empty field should clear only that mapping: %v", err)
	}
	if mapping.LocationFieldID != "" || mapping.RecurrenceFieldID != "recurrence" {
		t.Fatalf("empty update should clear only requested mapping: %#v", mapping)
	}
}

func TestCalendarWeekStartFromOperationData(t *testing.T) {
	weekStart, err := calendarWeekStartFromOperationData(float64(0))
	if err != nil {
		t.Fatalf("float sunday should be accepted: %v", err)
	}
	if weekStart != av.WeekStartSunday {
		t.Fatalf("expected sunday, got %d", weekStart)
	}

	weekStart, err = calendarWeekStartFromOperationData(1)
	if err != nil {
		t.Fatalf("int monday should be accepted: %v", err)
	}
	if weekStart != av.WeekStartMonday {
		t.Fatalf("expected monday, got %d", weekStart)
	}

	if _, err = calendarWeekStartFromOperationData(float64(2)); err == nil {
		t.Fatal("invalid week start should be rejected")
	}
	if _, err = calendarWeekStartFromOperationData(float64(1.5)); err == nil {
		t.Fatal("fractional week start should be rejected")
	}
	if _, err = calendarWeekStartFromOperationData("1"); err == nil {
		t.Fatal("non-number week start should be rejected")
	}
}

func TestCalendarViewModeFromOperationData(t *testing.T) {
	viewMode, err := calendarViewModeFromOperationData(float64(0))
	if err != nil {
		t.Fatalf("float month should be accepted: %v", err)
	}
	if viewMode != av.ViewModeMonth {
		t.Fatalf("expected month, got %d", viewMode)
	}

	viewMode, err = calendarViewModeFromOperationData(3)
	if err != nil {
		t.Fatalf("int schedule should be accepted: %v", err)
	}
	if viewMode != av.ViewModeSchedule {
		t.Fatalf("expected schedule, got %d", viewMode)
	}

	if _, err = calendarViewModeFromOperationData(float64(4)); err == nil {
		t.Fatal("invalid view mode should be rejected")
	}
	if _, err = calendarViewModeFromOperationData(float64(1.5)); err == nil {
		t.Fatal("fractional view mode should be rejected")
	}
	if _, err = calendarViewModeFromOperationData("1"); err == nil {
		t.Fatal("non-number view mode should be rejected")
	}
}

func TestAddCalendarField(t *testing.T) {
	calendar := &av.LayoutCalendar{
		BaseLayout: &av.BaseLayout{WrapField: true},
		Fields: []*av.ViewCalendarCardField{
			{BaseField: &av.BaseField{ID: "first"}},
			{BaseField: &av.BaseField{ID: "second"}},
		},
	}

	addCalendarField(calendar, &av.BaseField{ID: "inserted"}, "first")
	if len(calendar.Fields) != 3 {
		t.Fatalf("expected 3 fields, got %d", len(calendar.Fields))
	}
	if calendar.Fields[1].ID != "inserted" {
		t.Fatalf("expected inserted field after first, got %s", calendar.Fields[1].ID)
	}
	if !calendar.Fields[1].Wrap {
		t.Fatal("inserted field should inherit calendar wrap setting")
	}

	addCalendarField(calendar, &av.BaseField{ID: "fallback"}, "missing")
	if calendar.Fields[len(calendar.Fields)-1].ID != "fallback" {
		t.Fatalf("missing previous field should append, got %s", calendar.Fields[len(calendar.Fields)-1].ID)
	}
}

func TestRemoveCalendarFieldReferences(t *testing.T) {
	calendar := &av.LayoutCalendar{
		DateFieldID: "date",
		Fields: []*av.ViewCalendarCardField{
			{BaseField: &av.BaseField{ID: "date"}},
			{BaseField: &av.BaseField{ID: "recurrence"}},
			{BaseField: &av.BaseField{ID: "color"}},
		},
		FieldMapping: &av.CalendarFieldMapping{
			RecurrenceFieldID:  "recurrence",
			ExceptionFieldID:   "exception",
			LocationFieldID:    "location",
			DescriptionFieldID: "description",
			ColorFieldID:       "color",
		},
	}

	removeCalendarFieldReferences(calendar, "date")
	if calendar.DateFieldID != "" {
		t.Fatalf("date field should be cleared, got %s", calendar.DateFieldID)
	}
	if len(calendar.Fields) != 2 || calendar.Fields[0].ID != "recurrence" {
		t.Fatalf("date field should be removed from fields: %#v", calendar.Fields)
	}

	removeCalendarFieldReferences(calendar, "recurrence")
	if calendar.FieldMapping.RecurrenceFieldID != "" {
		t.Fatalf("recurrence mapping should be cleared, got %s", calendar.FieldMapping.RecurrenceFieldID)
	}
	removeCalendarFieldReferences(calendar, "color")
	if calendar.FieldMapping.ColorFieldID != "" {
		t.Fatalf("color mapping should be cleared, got %s", calendar.FieldMapping.ColorFieldID)
	}
}

func TestPruneCalendarFieldReferencesByType(t *testing.T) {
	newCalendar := func() *av.LayoutCalendar {
		return &av.LayoutCalendar{
			DateFieldID: "date",
			FieldMapping: &av.CalendarFieldMapping{
				RecurrenceFieldID:  "recurrence",
				ExceptionFieldID:   "exception",
				LocationFieldID:    "location",
				DescriptionFieldID: "description",
				ColorFieldID:       "color",
			},
		}
	}

	calendar := newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "date", av.KeyTypeNumber)
	if calendar.DateFieldID != "" {
		t.Fatalf("date field should be cleared after type change, got %s", calendar.DateFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "recurrence", av.KeyTypeNumber)
	if calendar.FieldMapping.RecurrenceFieldID != "" {
		t.Fatalf("recurrence mapping should be cleared after type change, got %s", calendar.FieldMapping.RecurrenceFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "recurrence", av.KeyTypeTemplate)
	if calendar.FieldMapping.RecurrenceFieldID != "recurrence" {
		t.Fatalf("template stays valid for recurrence mapping, got %s", calendar.FieldMapping.RecurrenceFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "color", av.KeyTypeText)
	if calendar.FieldMapping.ColorFieldID != "" {
		t.Fatalf("color mapping should be cleared after type change, got %s", calendar.FieldMapping.ColorFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "color", av.KeyTypeMSelect)
	if calendar.FieldMapping.ColorFieldID != "color" {
		t.Fatalf("mSelect stays valid for color mapping, got %s", calendar.FieldMapping.ColorFieldID)
	}

	calendar = newCalendar()
	pruneCalendarFieldReferencesByType(calendar, "unrelated", av.KeyTypeNumber)
	if calendar.DateFieldID != "date" || calendar.FieldMapping.LocationFieldID != "location" {
		t.Fatalf("unrelated key must not touch calendar references: %#v", calendar.FieldMapping)
	}
}
