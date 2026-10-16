package main

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type gameCodes struct {
	Loot          int `json:"loot"`
	Death         int `json:"death"`
	Player        int `json:"player"`
	Join          int `json:"join"`
	ChestLog      int `json:"chestLog"`
	ItemEquipment int `json:"itemEquipment"`
	ItemSimple    int `json:"itemSimple"`
}

func loadCodes() gameCodes {
	codes := gameCodes{Loot: 278, Death: 164, Player: 29, Join: 2, ChestLog: 157, ItemEquipment: 30, ItemSimple: 32}
	exe, _ := os.Executable()
	if data, err := os.ReadFile(filepath.Join(filepath.Dir(exe), "events.json")); err == nil {
		json.Unmarshal(data, &codes)
	}
	return codes
}

type ledger struct {
	mu       sync.Mutex
	out      *json.Encoder
	codes    gameCodes
	device   string
	messages int
	values   map[[2]int]int
}

func newLedger(out io.Writer) *ledger {
	return &ledger{out: json.NewEncoder(out), codes: loadCodes(), values: map[[2]int]int{}}
}

func (l *ledger) emit(event map[string]interface{}) {
	l.mu.Lock()
	defer l.mu.Unlock()
	event["time"] = time.Now().UTC().Format(time.RFC3339Nano)
	l.out.Encode(event)
}

func (l *ledger) accepts(device string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.device == "" {
		l.device = device
	}
	return l.device == device
}

func (l *ledger) reportTraffic() {
	l.mu.Lock()
	count := l.messages
	l.mu.Unlock()
	l.emit(map[string]interface{}{"type": "traffic", "messages": count})
}

func (l *ledger) countMessage() {
	l.mu.Lock()
	l.messages++
	l.mu.Unlock()
}

func (l *ledger) onEvent(device string, params map[byte]interface{}) {
	l.countMessage()
	code, _ := toInt(params[252])
	switch code {
	case l.codes.Loot:
		if isSilver, _ := params[3].(bool); isSilver || !l.accepts(device) {
			return
		}
		item, _ := toInt(params[4])
		qty, _ := toInt(params[5])
		l.emit(map[string]interface{}{"type": "loot", "looter": text(params[2]), "from": text(params[1]), "item": item, "qty": qty})
	case l.codes.Death:
		if l.accepts(device) {
			l.emit(map[string]interface{}{"type": "death", "died": text(params[2]), "diedGuild": text(params[3]),
				"killer": text(params[10]), "killerGuild": text(params[11])})
		}
	case l.codes.Player:
		if l.accepts(device) {
			l.emit(map[string]interface{}{"type": "player", "name": text(params[1]), "guild": text(params[8]), "alliance": text(params[51])})
		}
	case l.codes.ItemEquipment, l.codes.ItemSimple:
		if l.accepts(device) {
			l.itemValue(params, code == l.codes.ItemEquipment)
		}
	}
}

func (l *ledger) itemValue(params map[byte]interface{}, isEquipment bool) {
	item, _ := toInt(params[1])
	internal, _ := toInt(params[4])
	silver := internal / 10000
	quality := 0
	if isEquipment {
		qualityKey := byte(6)
		if _, isCrafter := params[6].(string); isCrafter {
			qualityKey = 7
		}
		quality, _ = toInt(params[qualityKey])
	}
	if item <= 0 || silver <= 0 || !l.isNewValue(item, quality, silver) {
		return
	}
	l.emit(map[string]interface{}{"type": "value", "item": item, "quality": quality, "value": silver})
}

func (l *ledger) isNewValue(item, quality, silver int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	key := [2]int{item, quality}
	if l.values[key] == silver {
		return false
	}
	l.values[key] = silver
	return true
}

func (l *ledger) onResponse(device string, opCode byte, params map[byte]interface{}) {
	l.countMessage()
	code, ok := toInt(params[253])
	if !ok {
		code = int(opCode)
	}
	if code == l.codes.Join && l.accepts(device) {
		l.emit(map[string]interface{}{"type": "self", "name": text(params[2]), "guild": text(params[58]),
			"alliance": text(params[79]), "map": text(params[8])})
	}
	if code == l.codes.ChestLog && l.accepts(device) {
		l.emit(map[string]interface{}{"type": "chest-log-raw", "params": simplify(params)})
	}
}

func text(value interface{}) string {
	if s, ok := value.(string); ok {
		return s
	}
	return ""
}
