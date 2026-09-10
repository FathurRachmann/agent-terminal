package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const version = "0.1.0"

var (
	titleStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("212"))
	dimStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("241"))
	boxStyle   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(0, 1)
)

type model struct {
	cwd         string
	autoApprove bool
	input       string
	chat        []string
	status      string
	width       int
	height      int
	running     bool
}

type runDoneMsg struct {
	out string
	err error
}

func initialModel() model {
	cwd, _ := os.Getwd()
	if v := os.Getenv("AGENT_WORKSPACE"); v != "" {
		cwd = v
	}
	return model{
		cwd:         cwd,
		autoApprove: false,
		status:      fmt.Sprintf("agent-go %s · ready", version),
		chat: []string{
			"Go Bubbletea shell for Agent Terminal.",
			"Enter a task and press Enter. Esc / ctrl+c to quit.",
		},
	}
}

func (m model) Init() tea.Cmd {
	return nil
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case tea.KeyMsg:
		if m.running {
			return m, nil
		}
		switch msg.Type {
		case tea.KeyCtrlC, tea.KeyEsc:
			return m, tea.Quit
		case tea.KeyEnter:
			prompt := strings.TrimSpace(m.input)
			if prompt == "" {
				return m, nil
			}
			m.chat = append(m.chat, "You: "+prompt)
			m.input = ""
			m.running = true
			m.status = "running TypeScript runtime…"
			return m, runAgent(m.cwd, prompt, m.autoApprove)
		case tea.KeyBackspace:
			if len(m.input) > 0 {
				m.input = m.input[:len(m.input)-1]
			}
			return m, nil
		case tea.KeyRunes:
			m.input += string(msg.Runes)
			return m, nil
		}
	case runDoneMsg:
		m.running = false
		if msg.err != nil {
			m.status = "error"
			m.chat = append(m.chat, "Error: "+msg.err.Error())
			if msg.out != "" {
				m.chat = append(m.chat, msg.out)
			}
		} else {
			m.status = "ready"
			m.chat = append(m.chat, "Agent:\n"+strings.TrimSpace(msg.out))
		}
		return m, nil
	}
	return m, nil
}

func (m model) View() string {
	w := m.width
	if w <= 0 {
		w = 80
	}
	chat := strings.Join(tail(m.chat, 20), "\n")
	body := boxStyle.Width(w - 4).Render(chat)
	footer := fmt.Sprintf("%s\n> %s█", dimStyle.Render(m.status+" · cwd "+m.cwd), m.input)
	return titleStyle.Render("Agent Terminal (Go)") + "\n" + body + "\n" + footer
}

func tail(items []string, n int) []string {
	if len(items) <= n {
		return items
	}
	return items[len(items)-n:]
}

func runAgent(cwd, prompt string, autoApprove bool) tea.Cmd {
	return func() tea.Msg {
		runtime := os.Getenv("AGENT_RUNTIME")
		var cmd *exec.Cmd
		args := []string{"--cwd", cwd}
		if autoApprove {
			args = append(args, "--yes")
		}
		args = append(args, prompt)

		if runtime != "" {
			cmd = exec.Command(runtime, args...)
		} else {
			// Prefer local npm script from repo root (parent of go/)
			root := findRepoRoot(cwd)
			cmd = exec.Command("npm", append([]string{"run", "agent", "--"}, args...)...)
			cmd.Dir = root
		}
		cmd.Env = os.Environ()
		out, err := cmd.CombinedOutput()
		return runDoneMsg{out: string(out), err: err}
	}
}

func findRepoRoot(start string) string {
	dir := start
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	// When binary is run from go/, repo root is parent
	exe, err := os.Executable()
	if err == nil {
		cand := filepath.Clean(filepath.Join(filepath.Dir(exe), "..", ".."))
		if _, err := os.Stat(filepath.Join(cand, "package.json")); err == nil {
			return cand
		}
	}
	return start
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--help", "-h":
			fmt.Println(`agent (Go Bubbletea shell)

Usage:
  agent                  # interactive TUI
  agent --version

Environment:
  AGENT_WORKSPACE   workspace root
  AGENT_RUNTIME     path to compiled TS/Node agent binary (optional)
  ROUTER_API_KEY    passed through to the TypeScript runtime
`)
			return
		case "--version", "-v":
			fmt.Println(version)
			return
		}
	}

	p := tea.NewProgram(initialModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
