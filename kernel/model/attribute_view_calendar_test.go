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
	if err := validateCalendarMappingField(attrView, "date", "colorFieldID", av.KeyTypeSelect, av.KeyTypeMSelect); nil == err {
		t.Fatal("date field should be rejected for color mapping")
	}
	if err := validateCalendarMappingField(attrView, "missing", "locationFieldID", av.KeyTypeText); nil == err {
		t.Fatal("missing field should be rejected")
	}
}
