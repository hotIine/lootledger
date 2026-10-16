package main

import (
	"fmt"
	"reflect"
)

// simplify converts decoded Photon values into something encoding/json can handle.
func simplify(value interface{}) interface{} {
	switch v := value.(type) {
	case nil, bool, string, int8, int16, int32, int64, uint8, uint16, uint32, uint64, float32, float64, int:
		return v
	case []byte:
		return fmt.Sprintf("<%d bytes>", len(v))
	case map[byte]interface{}:
		out := make(map[string]interface{}, len(v))
		for key, item := range v {
			out[fmt.Sprint(key)] = simplify(item)
		}
		return out
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() == reflect.Slice || rv.Kind() == reflect.Array {
		out := make([]interface{}, rv.Len())
		for i := range out {
			out[i] = simplify(rv.Index(i).Interface())
		}
		return out
	}
	return fmt.Sprint(value)
}

func toInt(value interface{}) (int, bool) {
	switch v := value.(type) {
	case int8:
		return int(v), true
	case int16:
		return int(v), true
	case int32:
		return int(v), true
	case int64:
		return int(v), true
	case uint8:
		return int(v), true
	case uint16:
		return int(v), true
	case uint32:
		return int(v), true
	case int:
		return v, true
	}
	return 0, false
}
