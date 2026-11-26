// Command check-go-dead-exports 扫描 backend/internal 下的导出函数与方法，
// 拦截全仓（含测试与各构建标签文件）零引用的孤立导出符号，补齐 staticcheck U1000 仅查未导出符号的盲区。
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// standardInterfaceMethods 为 Go 标准库、GORM 与 HTTP 接口约定的常见方法名，
// 可能经由接口动态派发或反射调用，不计入静态未引用误报。
var standardInterfaceMethods = map[string]bool{
	"Close":         true,
	"Error":         true,
	"MarshalJSON":   true,
	"Scan":          true,
	"ServeHTTP":     true,
	"String":        true,
	"TableName":     true,
	"UnmarshalJSON": true,
	"Unwrap":        true,
	"Value":         true,
}

type exportedFunc struct {
	kind    string
	pkg     string
	name    string
	pos     string
	namePos token.Pos
}

func findDeadExports(backendRoot string) ([]exportedFunc, error) {
	fset := token.NewFileSet()
	internalRoot := filepath.Join(backendRoot, "internal")

	var decls []exportedFunc
	identUses := map[string]int{}
	selectorUses := map[string]int{}

	err := filepath.WalkDir(backendRoot, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() || !strings.HasSuffix(path, ".go") {
			return walkErr
		}
		file, parseErr := parser.ParseFile(fset, path, nil, 0)
		if parseErr != nil {
			return fmt.Errorf("parse %s: %w", path, parseErr)
		}

		// 收集本文件内全部标识符与选择器引用（先统记，再在汇总时排除声明节点本身）。
		ast.Inspect(file, func(n ast.Node) bool {
			switch node := n.(type) {
			case *ast.SelectorExpr:
				selectorUses[node.Sel.Name]++
			case *ast.Ident:
				identUses[node.Name]++
			}
			return true
		})

		relToInternal, relErr := filepath.Rel(internalRoot, path)
		if relErr != nil || strings.HasPrefix(relToInternal, "..") || strings.HasSuffix(path, "_test.go") {
			return nil
		}

		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || !fn.Name.IsExported() {
				continue
			}
			if fn.Recv != nil && standardInterfaceMethods[fn.Name.Name] {
				continue
			}
			kind := "func"
			if fn.Recv != nil {
				kind = "method"
			}
			relPath, _ := filepath.Rel(backendRoot, path)
			pos := fset.Position(fn.Pos())
			decls = append(decls, exportedFunc{
				kind:    kind,
				pkg:     file.Name.Name,
				name:    fn.Name.Name,
				pos:     fmt.Sprintf("%s:%d", filepath.ToSlash(relPath), pos.Line),
				namePos: fn.Name.Pos(),
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 统计同名函数声明次数，确保同一名称被多次声明为函数时精确扣除声明节点本身。
	funcDeclCounts := map[string]int{}
	for _, d := range decls {
		if d.kind == "func" {
			funcDeclCounts[d.name]++
		}
	}

	var dead []exportedFunc
	for _, d := range decls {
		if d.kind == "method" {
			if selectorUses[d.name] == 0 {
				dead = append(dead, d)
			}
			continue
		}
		// 顶层导出函数：总 Ident 计数扣除自身声明节点后为 0 即全仓零引用。
		if identUses[d.name]-funcDeclCounts[d.name] <= 0 {
			dead = append(dead, d)
		}
	}
	slices.SortFunc(dead, func(a, b exportedFunc) int {
		return strings.Compare(a.pos, b.pos)
	})
	return dead, nil
}

func runSelfTest() error {
	tmpDir, err := os.MkdirTemp("", "check-go-dead-exports-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(tmpDir) }()

	files := map[string]string{
		"internal/demo/demo.go": `package demo
type Store struct{}
func (Store) TableName() string { return "demo" }
func (s *Store) UsedMethod() {}
func (s *Store) DeadMethod() {}
func UsedFunc() {}
func DeadFunc() {}
`,
		"cmd/app/main.go": `package main
import "example/internal/demo"
func main() {
	var s demo.Store
	s.UsedMethod()
	demo.UsedFunc()
}
`,
	}
	for rel, content := range files {
		full := filepath.Join(tmpDir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(full, []byte(content), 0o600); err != nil {
			return err
		}
	}

	dead, err := findDeadExports(tmpDir)
	if err != nil {
		return err
	}
	var got []string
	for _, d := range dead {
		got = append(got, d.kind+":"+d.name)
	}
	slices.Sort(got)
	want := []string{"func:DeadFunc", "method:DeadMethod"}
	if !slices.Equal(got, want) {
		return fmt.Errorf("self-test mismatch: got %v, want %v", got, want)
	}
	return nil
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--self-test" {
		if err := runSelfTest(); err != nil {
			fmt.Fprintf(os.Stderr, "check-go-dead-exports self-test failed: %v\n", err)
			os.Exit(1)
		}
		return
	}

	backendRoot := "."
	if len(os.Args) > 1 {
		backendRoot = os.Args[1]
	}
	dead, err := findDeadExports(backendRoot)
	if err != nil {
		fmt.Fprintf(os.Stderr, "check-go-dead-exports error: %v\n", err)
		os.Exit(1)
	}
	if len(dead) > 0 {
		fmt.Fprintln(os.Stderr, "Found unreferenced exported Go functions/methods in backend/internal/ (delete or unexport):")
		for _, d := range dead {
			fmt.Fprintf(os.Stderr, "  %s - %s %s.%s\n", d.pos, d.kind, d.pkg, d.name)
		}
		os.Exit(1)
	}
}
