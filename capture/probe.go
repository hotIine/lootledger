package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// recorder dumps every event, for remapping event codes after a patch.
type recorder struct {
	mu     sync.Mutex
	out    *bufio.Writer
	counts map[int]int
	total  int
}

func runProbe(adapters []adapter) {
	exe, _ := os.Executable()
	path := filepath.Join(filepath.Dir(exe), "capture-test.jsonl")
	file, err := os.Create(path)
	if err != nil {
		fail(fmt.Sprintf("Could not create %s: %v", path, err))
	}
	rec := &recorder{out: bufio.NewWriter(file), counts: map[int]int{}}
	for _, a := range adapters {
		go listen(a, rec.event, rec.response)
	}
	fmt.Printf("Listening for Albion traffic on %d network adapter(s).\n", len(adapters))
	fmt.Printf("Writing events to %s\n", path)
	fmt.Println("Play for a while, then close this window or press Ctrl+C.")
	waitForStop(rec, file)
}

// param 252 holds the event code
func (r *recorder) event(device string, params map[byte]interface{}) {
	code := -1
	if n, ok := toInt(params[252]); ok {
		code = n
	}
	r.write("event", code, device, params)
}

// param 253 holds the operation code
func (r *recorder) response(device string, opCode byte, params map[byte]interface{}) {
	code, ok := toInt(params[253])
	if !ok {
		code = int(opCode)
	}
	r.write("response", code, device, params)
}

func (r *recorder) write(kind string, code int, device string, params map[byte]interface{}) {
	line, err := json.Marshal(map[string]interface{}{
		"time": time.Now().UTC().Format(time.RFC3339Nano), "kind": kind, "code": code, "device": device, "params": simplify(params),
	})
	if err != nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.out.Write(append(line, '\n'))
	r.counts[code]++
	r.total++
}

func waitForStop(rec *recorder, file *os.File) {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt)
	tick := time.NewTicker(10 * time.Second)
	for {
		select {
		case <-tick.C:
			rec.mu.Lock()
			fmt.Printf("%s  events seen: %d (%d kinds)\n", time.Now().Format("15:04:05"), rec.total, len(rec.counts))
			rec.out.Flush()
			rec.mu.Unlock()
		case <-stop:
			rec.mu.Lock()
			rec.out.Flush()
			file.Close()
			printSummary(rec.counts)
			rec.mu.Unlock()
			return
		}
	}
}

func printSummary(counts map[int]int) {
	codes := make([]int, 0, len(counts))
	for code := range counts {
		codes = append(codes, code)
	}
	sort.Ints(codes)
	fmt.Println("Event codes seen (code: count):")
	for _, code := range codes {
		fmt.Printf("  %d: %d\n", code, counts[code])
	}
}
