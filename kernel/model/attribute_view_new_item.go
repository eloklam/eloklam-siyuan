// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"fmt"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// NewItemTemplatePreview 描述新增条目模板在当前数据库实例中的解析结果。
type NewItemTemplatePreview struct {
	PrimaryKey string   `json:"primaryKey"`
	BoxID      string   `json:"boxID,omitempty"`
	HPath      string   `json:"hPath,omitempty"`
	Warnings   []string `json:"warnings,omitempty"`

	parentID string
}

// CreateAttributeViewItemResult 描述按模板创建数据库条目的结果。
type CreateAttributeViewItemResult struct {
	ItemID      string       `json:"itemID"`
	BlockID     string       `json:"blockID"`
	Content     string       `json:"content"`
	IsDetached  bool         `json:"isDetached"`
	Warnings    []string     `json:"warnings,omitempty"`
	Transaction *Transaction `json:"-"`
}

const (
	CreateAttributeViewItemDocsSaveModeSubDoc   = "subDoc"
	CreateAttributeViewItemDocsSaveModeTemplate = "template"
)

var attributeViewItemDocsLocks sync.Map

// CreateAttributeViewItemDocsResult 描述将游离条目批量转换为文档后的结果。
type CreateAttributeViewItemDocsResult struct {
	ItemIDs        []string     `json:"itemIDs"`
	BlockIDs       []string     `json:"blockIDs"`
	SkippedItemIDs []string     `json:"skippedItemIDs,omitempty"`
	Warnings       []string     `json:"warnings,omitempty"`
	Transaction    *Transaction `json:"-"`
}

// CreateItemOptions 描述调用方对新增条目的额外要求，全部可选。
type CreateItemOptions struct {
	// PrimaryKey 调用方指定的主键内容（文档类型模板下即文档标题）。
	// 为空（或仅空白）时回退到模板的 primaryKeyTemplate，与旧行为一致。
	PrimaryKey string
	// FieldValues 需要与插入操作在同一个事务中写入的字段值，键为字段 ID。
	// 与模板自带的字段默认值合并，调用方提供的值优先。
	FieldValues map[string]*av.Value
}

// defaultDocumentNewItemTemplate 在调用方没有指定模板、而目标视图是「新条目即页面」的日历视图时，
// 返回一个文档类型的新增条目模板。优先复用数据库上已有的文档模板（用户可以在上游的模板编辑器里改保存位置），
// 没有时就地合成一个等价的（空 BoxID/PathTemplate = 数据库块所在笔记本 + 以其根文档为父）。
// 返回 nil 表示保持上游默认（游离条目）。
func defaultDocumentNewItemTemplate(attrView *av.AttributeView, blockID, viewID string) *av.NewItemTemplate {
	var view *av.View
	if "" != viewID {
		view = attrView.GetView(viewID)
	}
	if nil == view {
		view, _ = getAttrViewViewByBlockID(attrView, blockID)
	}
	if nil == view || av.LayoutTypeCalendar != view.LayoutType || nil == view.Calendar {
		return nil
	}
	if av.CalendarNewItemTargetDocument != view.Calendar.NewItemTarget {
		return nil
	}
	for _, itemTemplate := range attrView.NewItemTemplates {
		if nil != itemTemplate && av.NewItemTargetDocument == itemTemplate.TargetType {
			return itemTemplate
		}
	}
	return &av.NewItemTemplate{
		ID:           ast.NewNodeID(),
		Name:         calendarNewItemTemplateName(),
		TargetType:   av.NewItemTargetDocument,
		SaveLocation: &av.NewItemSaveLocation{BoxID: "", PathTemplate: ""},
	}
}

func mergeCreateItemOptions(options []*CreateItemOptions) (ret *CreateItemOptions) {
	ret = &CreateItemOptions{}
	for _, option := range options {
		if nil == option {
			continue
		}
		if "" != option.PrimaryKey {
			ret.PrimaryKey = option.PrimaryKey
		}
		if 0 < len(option.FieldValues) {
			ret.FieldValues = option.FieldValues
		}
	}
	return
}

// CreateAttributeViewItem 按指定模板创建一个数据库条目。templateID 为空时创建空白游离条目。
// options 可选，用于覆盖主键内容以及在同一个事务中写入字段值。
func CreateAttributeViewItem(avID, blockID, viewID, templateID, previousID, groupID string, options ...*CreateItemOptions) (*CreateAttributeViewItemResult, error) {
	opts := mergeCreateItemOptions(options)
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return nil, err
	}
	createdAt := time.Now()
	itemTemplate := attrView.GetNewItemTemplate(templateID)
	var prunedOptions []*av.PrunedNewItemTemplateOption
	if "" != templateID && nil == itemTemplate {
		return nil, fmt.Errorf("new item template [%s] not found", templateID)
	}
	if nil == itemTemplate && "" == templateID {
		// 没有显式指定模板时，若目标视图是「每个条目是一个页面」的日历视图，则默认按文档模板创建。
		itemTemplate = defaultDocumentNewItemTemplate(attrView, blockID, viewID)
	}
	if nil == itemTemplate {
		itemTemplate = &av.NewItemTemplate{TargetType: av.NewItemTargetDetached}
	} else {
		cloned := *attrView
		prunedOptions = cloned.PruneInvalidNewItemTemplateFieldValues()
		if err = cloned.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{itemTemplate}}); nil != err {
			return nil, err
		}
		attrView = &cloned
		itemTemplate = cloned.NewItemTemplates[0]
	}
	preview, err := resolveAttributeViewNewItemTemplate(blockID, itemTemplate, createdAt, opts.PrimaryKey)
	if nil != err {
		return nil, err
	}
	for _, prunedOption := range prunedOptions {
		if templateID == prunedOption.TemplateID {
			preview.Warnings = append(preview.Warnings, fmt.Sprintf(Conf.Language(353),
				prunedOption.KeyID, strings.Join(prunedOption.Values, ", ")))
		}
	}

	itemID := ast.NewNodeID()
	fieldValues, err := resolveNewItemFieldValues(attrView, itemTemplate, createdAt)
	if nil != err {
		return nil, err
	}
	callerFieldValues, err := resolveCallerItemFieldValues(attrView, opts.FieldValues)
	if nil != err {
		return nil, err
	}
	for keyID, value := range callerFieldValues {
		fieldValues[keyID] = value
	}
	dbTree, err := LoadTreeByBlockID(blockID)
	if nil != err {
		return nil, err
	}
	dbNode := treenode.GetNodeInTree(dbTree, blockID)
	if nil == dbNode {
		return nil, ErrBlockNotFound
	}
	boundBlockID := itemID
	isDetached := av.NewItemTargetDocument != itemTemplate.TargetType
	var createdTree *parse.Tree
	if !isDetached {
		boundBlockID, createdTree, err = createAttributeViewItemDocument(preview, itemTemplate)
		if nil != err {
			return nil, err
		}
	}

	doOperations := []*Operation{}
	if nil != createdTree {
		doOperations = append(doOperations, &Operation{Action: "restoreCreatedDoc", ID: boundBlockID, Tree: createdTree})
	}
	doOperations = append(doOperations, &Operation{
		Action: "insertAttrViewBlock", AvID: avID, BlockID: blockID, ViewID: viewID, GroupID: groupID,
		PreviousID: previousID, IgnoreDefaultFill: false,
		Srcs: []map[string]any{{"itemID": itemID, "id": boundBlockID, "content": preview.PrimaryKey, "isDetached": isDetached}},
	})
	fieldOperations := buildNewItemFieldValueOperations(attrView, fieldValues, itemID)
	doOperations = append(doOperations, fieldOperations...)
	doOperations = append(doOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})

	undoOperations := []*Operation{{Action: "removeAttrViewBlock", AvID: avID, SrcIDs: []string{itemID}}}
	if nil != createdTree {
		undoOperations = append(undoOperations, &Operation{Action: "removeCreatedDoc", ID: boundBlockID, Tree: createdTree})
	}
	undoOperations = append(undoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: dbNode.IALAttr("updated")})
	tx := &Transaction{DoOperations: doOperations, UndoOperations: undoOperations, Timestamp: createdAt.UnixMilli()}
	tx.MarkFromAPI()
	if err = PerformTxSync(tx); nil != err {
		cleanupErr := RemoveAttributeViewBlock([]string{itemID}, avID)
		if nil != createdTree {
			cleanupErr = errors.Join(cleanupErr, removeCreatedNewItemDoc(boundBlockID))
		}
		return nil, newItemCreationError(err, cleanupErr)
	}

	content := preview.PrimaryKey
	if !isDetached {
		if blockTree := treenode.GetBlockTree(boundBlockID); nil != blockTree {
			content = path.Base(blockTree.HPath)
		}
	}
	return &CreateAttributeViewItemResult{
		ItemID: itemID, BlockID: boundBlockID, Content: content, IsDetached: isDetached,
		Warnings: preview.Warnings, Transaction: tx,
	}, nil
}

// CreateAttributeViewItemDocs 将指定条目中的游离条目批量创建为文档并绑定。
func CreateAttributeViewItemDocs(avID, blockID, saveMode string, itemIDs []string) (*CreateAttributeViewItemDocsResult, error) {
	unlock := lockAttributeViewItemDocs(avID)
	defer unlock()

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return nil, err
	}
	itemTemplate, err := attributeViewItemDocumentTemplate(attrView, saveMode)
	if nil != err {
		return nil, err
	}
	dbTree, err := LoadTreeByBlockID(blockID)
	if nil != err {
		return nil, err
	}
	dbNode := treenode.GetNodeInTree(dbTree, blockID)
	if nil == dbNode {
		return nil, ErrBlockNotFound
	}

	type itemDoc struct {
		itemID   string
		original *av.Value
		bound    *av.Value
		preview  *NewItemTemplatePreview
		docID    string
		tree     *parse.Tree
	}
	createdAt := time.Now()
	seen := map[string]bool{}
	var items []*itemDoc
	ret := &CreateAttributeViewItemDocsResult{}
	for _, itemID := range itemIDs {
		if "" == itemID || seen[itemID] {
			continue
		}
		seen[itemID] = true
		value := attrView.GetBlockValue(itemID)
		if nil == value || !value.IsDetached || nil == value.Block {
			ret.SkippedItemIDs = append(ret.SkippedItemIDs, itemID)
			continue
		}
		preview, resolveErr := resolveAttributeViewItemDocument(blockID, value.Block.Content, itemTemplate, createdAt)
		if nil != resolveErr {
			return nil, resolveErr
		}
		original := value.Clone()
		if nil == original {
			return nil, fmt.Errorf("clone attribute view item [%s] failed", itemID)
		}
		items = append(items, &itemDoc{itemID: itemID, original: original, preview: preview})
		ret.Warnings = append(ret.Warnings, preview.Warnings...)
	}
	if 0 == len(items) {
		return ret, nil
	}

	cleanupCreatedDocs := func() error {
		var cleanupErr error
		for i := len(items) - 1; 0 <= i; i-- {
			if "" != items[i].docID {
				cleanupErr = errors.Join(cleanupErr, removeCreatedNewItemDoc(items[i].docID))
			}
		}
		return cleanupErr
	}
	for _, item := range items {
		item.docID, item.tree, err = createAttributeViewItemDocument(item.preview, itemTemplate)
		if nil != err {
			return nil, newItemCreationError(err, cleanupCreatedDocs())
		}
		icon, _ := getNodeAvBlockText(item.tree.Root, "")
		item.bound, err = newBoundAttributeViewItemValue(item.original, item.docID, icon)
		if nil != err {
			return nil, newItemCreationError(fmt.Errorf("bind attribute view item [%s] failed: %w", item.itemID, err), cleanupCreatedDocs())
		}
		ret.ItemIDs = append(ret.ItemIDs, item.itemID)
		ret.BlockIDs = append(ret.BlockIDs, item.docID)
	}

	var doOperations, undoOperations []*Operation
	for _, item := range items {
		doOperations = append(doOperations,
			&Operation{Action: "restoreCreatedDoc", ID: item.docID, Tree: item.tree},
			&Operation{
				Action: "replaceAttrViewBlock", AvID: avID, BlockID: blockID, PreviousID: item.itemID, NextID: item.docID,
				IsDetached: false,
			},
			&Operation{
				Action: "updateAttrViewCell", ID: item.bound.ID, AvID: avID, KeyID: item.bound.KeyID,
				RowID: item.itemID, Data: item.bound,
			},
		)
		undoOperations = append(undoOperations,
			&Operation{
				Action: "replaceAttrViewBlock", AvID: avID, BlockID: blockID, PreviousID: item.itemID,
				IsDetached: true,
			},
			&Operation{
				Action: "updateAttrViewCell", ID: item.original.ID, AvID: avID, KeyID: item.original.KeyID,
				RowID: item.itemID, Data: item.original,
			},
			&Operation{Action: "removeCreatedDoc", ID: item.docID, Tree: item.tree},
		)
	}
	doOperations = append(doOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: util.CurrentTimeSecondsStr()})
	undoOperations = append(undoOperations, &Operation{Action: "doUpdateUpdated", ID: blockID, Data: dbNode.IALAttr("updated")})
	tx := &Transaction{DoOperations: doOperations, UndoOperations: undoOperations, Timestamp: createdAt.UnixMilli()}
	tx.MarkFromAPI()
	if err = PerformTxSync(tx); nil != err {
		var cleanupErr error
		for _, item := range items {
			_, _, detachErr := replaceAttributeViewBlock(avID, item.itemID, "", true, nil)
			cleanupErr = errors.Join(cleanupErr, detachErr)
			_, restoreErr := UpdateAttributeViewCell(nil, avID, item.original.KeyID, item.itemID, item.original)
			cleanupErr = errors.Join(cleanupErr, restoreErr)
		}
		cleanupErr = errors.Join(cleanupErr, cleanupCreatedDocs())
		ReloadAttrView(avID)
		return nil, newItemCreationError(err, cleanupErr)
	}
	ret.Transaction = tx
	return ret, nil
}

func newBoundAttributeViewItemValue(original *av.Value, docID, icon string) (*av.Value, error) {
	bound := original.Clone()
	if nil == bound || nil == bound.Block {
		return nil, errors.New("clone attribute view item failed")
	}
	bound.IsDetached = false
	bound.Block.ID = docID
	bound.Block.Content = ""
	bound.Block.Icon = icon
	return bound, nil
}

func lockAttributeViewItemDocs(avID string) func() {
	lockValue, _ := attributeViewItemDocsLocks.LoadOrStore(avID, &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	return lock.Unlock
}

func attributeViewItemDocumentTemplate(attrView *av.AttributeView, saveMode string) (*av.NewItemTemplate, error) {
	switch saveMode {
	case CreateAttributeViewItemDocsSaveModeSubDoc:
		return &av.NewItemTemplate{
			TargetType:   av.NewItemTargetDocument,
			SaveLocation: &av.NewItemSaveLocation{},
		}, nil
	case CreateAttributeViewItemDocsSaveModeTemplate:
		itemTemplate := attrView.GetNewItemTemplate(attrView.DefaultTemplateID)
		if nil != itemTemplate && av.NewItemTargetDocument == itemTemplate.TargetType {
			return itemTemplate, nil
		}
		return &av.NewItemTemplate{TargetType: av.NewItemTargetDocument}, nil
	default:
		return nil, fmt.Errorf("invalid create attribute view item documents save mode [%s]", saveMode)
	}
}

func resolveAttributeViewNewItemTemplate(blockID string, itemTemplate *av.NewItemTemplate, createdAt time.Time, primaryKeyOverride string) (*NewItemTemplatePreview, error) {
	boxID := ""
	if blockTree := treenode.GetBlockTree(blockID); blockTree != nil {
		boxID = blockTree.BoxID
	} else {
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if blockTree := treenode.GetBlockTreeInBox(blockID, encBoxID); blockTree != nil {
				boxID = encBoxID
				break
			}
		}
	}
	primary := strings.TrimSpace(primaryKeyOverride)
	if "" == primary {
		rendered, err := RenderGoTemplateAtInBox(itemTemplate.PrimaryKeyTemplate, createdAt, boxID)
		if nil != err {
			return nil, err
		}
		primary = strings.TrimSpace(rendered)
	}
	preview := &NewItemTemplatePreview{PrimaryKey: primary}
	if av.NewItemTargetDocument != itemTemplate.TargetType {
		return preview, nil
	}
	return resolveAttributeViewItemDocument(blockID, primary, itemTemplate, createdAt)
}

func resolveAttributeViewItemDocument(blockID, primary string, itemTemplate *av.NewItemTemplate, createdAt time.Time) (*NewItemTemplatePreview, error) {
	blockTree := treenode.GetBlockTree(blockID)
	if blockTree == nil {
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if candidate := treenode.GetBlockTreeInBox(blockID, encBoxID); candidate != nil {
				blockTree = candidate
				break
			}
		}
	}
	if nil == blockTree {
		return nil, ErrBlockNotFound
	}
	primary = normalizeDocTitle(primary)

	boxID, pathTemplate, inherited, err := resolveNewItemSaveConfig(blockTree.BoxID, itemTemplate.SaveLocation)
	if nil != err {
		return nil, err
	}
	renderedPath, err := RenderGoTemplateAtInBox(pathTemplate, createdAt, boxID)
	if nil != err {
		return nil, err
	}
	renderedPath = util.TrimSpaceInPath(strings.TrimSpace(renderedPath))
	return newItemDocumentPreview(blockTree, boxID, renderedPath, primary, inherited), nil
}

func newItemDocumentPreview(blockTree *treenode.BlockTree, boxID, renderedPath, primary string, inherited bool) *NewItemTemplatePreview {
	preview := &NewItemTemplatePreview{PrimaryKey: primary, BoxID: boxID}
	if boxID != blockTree.BoxID && "" != renderedPath && !strings.HasPrefix(renderedPath, "/") {
		renderedPath = "/" + renderedPath
	}
	if "" == primary {
		primary = newItemTitleFromPath(renderedPath)
		preview.PrimaryKey = primary
	}
	parentTemplate := newItemParentPathTemplate(renderedPath)
	baseHPath := "/"
	if boxID == blockTree.BoxID && !strings.HasPrefix(parentTemplate, "/") {
		baseHPath = blockTree.HPath
		preview.parentID = blockTree.RootID
	}
	parentHPath := path.Clean(path.Join(baseHPath, parentTemplate))
	if "." == parentHPath || "" == parentHPath {
		parentHPath = "/"
	}
	if !strings.HasPrefix(parentHPath, "/") {
		parentHPath = "/" + parentHPath
	}
	if "" == primary {
		preview.HPath = strings.TrimSuffix(parentHPath, "/") + "/"
		if "/" == parentHPath {
			preview.HPath = "/"
		}
	} else {
		preview.HPath = path.Join(parentHPath, primary)
	}
	if inherited && boxID != blockTree.BoxID {
		preview.parentID = ""
	}
	return preview
}

func createAttributeViewItemDocument(preview *NewItemTemplatePreview, itemTemplate *av.NewItemTemplate) (docID string, tree *parse.Tree, err error) {
	docID = ast.NewNodeID()
	arg := map[string]any{"titleEmpty": "" == preview.PrimaryKey}
	docID, err = CreateWithMarkdown("", preview.BoxID, preview.HPath, "", preview.parentID, docID, false, "", arg)
	if nil != err {
		return
	}
	if "" != itemTemplate.ContentTemplatePath {
		if err = applyNewItemContentTemplate(itemTemplate.ContentTemplatePath, docID); nil != err {
			err = newItemCreationError(err, removeCreatedNewItemDoc(docID))
			return
		}
	}
	tree, err = LoadTreeByBlockID(docID)
	if nil != err {
		err = newItemCreationError(err, removeCreatedNewItemDoc(docID))
		return
	}
	if applyNewItemDocumentAttrs(tree, itemTemplate) {
		if err = indexWriteTreeUpsertQueue(tree); nil != err {
			err = newItemCreationError(err, removeCreatedNewItemDoc(docID))
			return
		}
		FlushTxQueue()
	}
	return
}

func applyNewItemDocumentAttrs(tree *parse.Tree, itemTemplate *av.NewItemTemplate) (changed bool) {
	if "" != itemTemplate.Icon && tree.Root.IALAttr("icon") != itemTemplate.Icon {
		tree.Root.SetIALAttr("icon", itemTemplate.Icon)
		changed = true
	}
	if itemTemplate.HideInFileTree {
		if "true" != tree.Root.IALAttr(DocHiddenAttr) {
			tree.Root.SetIALAttr(DocHiddenAttr, "true")
			changed = true
		}
	} else if "" != tree.Root.IALAttr(DocHiddenAttr) {
		tree.Root.RemoveIALAttr(DocHiddenAttr)
		changed = true
	}
	return
}

func resolveNewItemSaveConfig(currentBoxID string, location *av.NewItemSaveLocation) (boxID, pathTemplate string, inherited bool, err error) {
	if nil != location {
		boxID = location.BoxID
		if "" == boxID {
			boxID = currentBoxID
		}
		if nil == Conf.Box(boxID) {
			return "", "", false, ErrBoxNotFound
		}
		if err = validateNewItemSaveBox(currentBoxID, boxID); nil != err {
			return "", "", false, err
		}
		return boxID, location.PathTemplate, false, nil
	}

	inherited = true
	boxID, pathTemplate = ResolveDocCreateSaveLocation(currentBoxID)
	err = validateNewItemSaveBox(currentBoxID, boxID)
	return
}

func validateNewItemSaveBox(currentBoxID, targetBoxID string) error {
	if IsEncryptedBox(currentBoxID) && currentBoxID != targetBoxID {
		return errors.New("new attribute view item document in an encrypted notebook must be saved in the current notebook")
	}
	return nil
}

func newItemParentPathTemplate(renderedPath string) string {
	if "" == renderedPath || strings.HasSuffix(renderedPath, "/") {
		return renderedPath
	}
	isAbsolute := strings.HasPrefix(renderedPath, "/")
	segments := strings.FieldsFunc(renderedPath, func(r rune) bool { return '/' == r })
	if 1 >= len(segments) {
		if isAbsolute {
			return "/"
		}
		return ""
	}
	parent := strings.Join(segments[:len(segments)-1], "/")
	if isAbsolute {
		parent = "/" + parent
	}
	return parent
}

func newItemTitleFromPath(renderedPath string) string {
	if "" == renderedPath || strings.HasSuffix(renderedPath, "/") {
		return ""
	}
	return normalizeDocTitle(path.Base(renderedPath))
}

func resolveNewItemFieldValues(attrView *av.AttributeView, itemTemplate *av.NewItemTemplate, createdAt time.Time) (ret map[string]*av.Value, err error) {
	ret = map[string]*av.Value{}
	for keyID, fieldValue := range itemTemplate.FieldValues {
		key, getErr := attrView.GetKey(keyID)
		if nil != getErr || nil == key {
			return nil, fmt.Errorf("new item template field [%s] not found", keyID)
		}
		var value *av.Value
		switch fieldValue.Mode {
		case av.NewItemFieldValueCurrentTime:
			if av.KeyTypeDate != key.Type {
				return nil, fmt.Errorf("new item template field [%s] current time value is invalid", keyID)
			}
			isNotTime := true
			if nil != key.Date {
				isNotTime = !key.Date.FillSpecificTime
			}
			value = &av.Value{Type: av.KeyTypeDate, Date: av.NewFormattedValueDate(createdAt.UnixMilli(), 0, av.DateFormatNone, isNotTime, false)}
		case av.NewItemFieldValueStatic:
			if nil == fieldValue.Value || fieldValue.Value.Type != key.Type {
				return nil, fmt.Errorf("new item template field [%s] value is invalid", keyID)
			}
			value = fieldValue.Value.Clone()
			if av.KeyTypeRelation == key.Type {
				filterNewItemTemplateRelationValue(attrView, key, value)
				if nil == value.Relation || 0 == len(value.Relation.BlockIDs) {
					continue
				}
			}
		default:
			return nil, fmt.Errorf("new item template field [%s] value mode is invalid", keyID)
		}
		ret[keyID] = value
	}
	return
}

func filterNewItemTemplateRelationValue(attrView *av.AttributeView, key *av.Key, value *av.Value) {
	if nil == key.Relation || nil == value.Relation {
		return
	}
	targetAv := attrView
	if key.Relation.AvID != attrView.ID {
		targetAv, _ = av.ParseAttributeView(key.Relation.AvID)
	}
	if nil == targetAv {
		value.Relation.BlockIDs = nil
		return
	}
	blockKey := targetAv.GetBlockKey()
	if nil == blockKey {
		value.Relation.BlockIDs = nil
		return
	}
	blockIDs := value.Relation.BlockIDs[:0]
	for _, blockID := range value.Relation.BlockIDs {
		if nil != targetAv.GetValue(blockKey.ID, blockID) {
			blockIDs = append(blockIDs, blockID)
		}
	}
	value.Relation.BlockIDs = blockIDs
}

// resolveCallerItemFieldValues 校验调用方直接传入的字段值，返回可以安全写入的副本。
// 主键（block）以及模板/汇总/创建时间/更新时间/行号这些计算字段一律拒绝：
// 绑定文档的条目主键由内核根据文档标题派生，计算字段每次渲染都会被覆盖。
func resolveCallerItemFieldValues(attrView *av.AttributeView, fieldValues map[string]*av.Value) (ret map[string]*av.Value, err error) {
	ret = map[string]*av.Value{}
	if 0 == len(fieldValues) {
		return
	}
	for keyID, value := range fieldValues {
		if nil == value {
			continue
		}
		key, getErr := attrView.GetKey(keyID)
		if nil != getErr || nil == key {
			return nil, fmt.Errorf("new item field [%s] not found", keyID)
		}
		if !isCallerWritableKeyType(key.Type) {
			return nil, fmt.Errorf("new item field [%s] type [%s] is not writable", keyID, key.Type)
		}
		if "" != value.Type && value.Type != key.Type {
			return nil, fmt.Errorf("new item field [%s] value type [%s] does not match field type [%s]", keyID, value.Type, key.Type)
		}
		cloned := value.Clone()
		if nil == cloned {
			return nil, fmt.Errorf("new item field [%s] value is invalid", keyID)
		}
		cloned.ID = ""
		cloned.KeyID = ""
		cloned.BlockID = ""
		cloned.Type = key.Type
		cloned.Block, cloned.Template, cloned.Created, cloned.Updated, cloned.Rollup = nil, nil, nil, nil, nil
		cloned.IsDetached = false
		cloned.IsRenderAutoFill = false
		if nil != cloned.Number {
			cloned.Number.Format = key.NumberFormat
			cloned.Number.FormattedContent = ""
		}
		if av.KeyTypeRelation == key.Type {
			filterNewItemTemplateRelationValue(attrView, key, cloned)
			// nil means the caller supplied no relation value. A non-nil relation
			// with zero targets is an explicit clear and must survive undo/replay.
			if nil == cloned.Relation {
				continue
			}
		}
		ret[keyID] = cloned
	}
	return
}

func isCallerWritableKeyType(keyType av.KeyType) bool {
	switch keyType {
	case av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL,
		av.KeyTypeEmail, av.KeyTypePhone, av.KeyTypeMAsset, av.KeyTypeCheckbox, av.KeyTypeRelation:
		return true
	}
	return false
}

func buildNewItemFieldValueOperations(attrView *av.AttributeView, fieldValues map[string]*av.Value, itemID string) (ret []*Operation) {
	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			continue
		}
		keyID := keyValues.Key.ID
		value := fieldValues[keyID]
		if nil == value {
			continue
		}
		ret = append(ret, &Operation{Action: "updateAttrViewCell", ID: ast.NewNodeID(), AvID: attrView.ID, KeyID: keyID, RowID: itemID, Data: value})
	}
	return
}

func applyNewItemContentTemplate(templatePath, docID string) error {
	return applyDocContentTemplateAfterIndex(templatePath, docID)
}

func removeCreatedNewItemDoc(docID string) error {
	blockTree := treenode.GetBlockTree(docID)
	if nil == blockTree {
		return nil
	}
	return RemoveDoc(blockTree.BoxID, blockTree.Path)
}

func newItemCreationError(createErr, cleanupErr error) error {
	if nil == cleanupErr {
		return createErr
	}
	return fmt.Errorf("%w; cleanup failed: %v", createErr, cleanupErr)
}
