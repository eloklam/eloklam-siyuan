"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFieldByID = exports.cloneCellValue = exports.getTextFromCell = exports.getBlockCell = exports.getCellByFieldID = void 0;
const getCellByFieldID = (card, fieldID) => {
    if (!fieldID) {
        return undefined;
    }
    return card.values.find(item => item.value?.keyID === fieldID || item.id === fieldID);
};
exports.getCellByFieldID = getCellByFieldID;
const getBlockCell = (card) => {
    return card.values.find(item => item.valueType === "block" || item.value?.type === "block");
};
exports.getBlockCell = getBlockCell;
const getTextFromCell = (cell) => {
    const value = cell?.value;
    if (!value) {
        return "";
    }
    return value.text?.content || value.template?.content || value.block?.content || value.url?.content || "";
};
exports.getTextFromCell = getTextFromCell;
const cloneCellValue = (value) => {
    if (!value) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
};
exports.cloneCellValue = cloneCellValue;
const getFieldByID = (fields, fieldID) => {
    if (!fieldID) {
        return undefined;
    }
    return fields.find(field => field.id === fieldID);
};
exports.getFieldByID = getFieldByID;
