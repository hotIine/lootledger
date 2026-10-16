// Command capture passively reads Albion traffic (UDP 5056) through Npcap and
// writes loot, death and player events to stdout as JSON lines. It exits when
// stdin is closed.
//
// With -probe it writes every event to capture-test.jsonl instead, for
// remapping event codes after a patch.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/google/gopacket"
	"github.com/google/gopacket/layers"
	"github.com/google/gopacket/pcap"

	"lootledger/capture/photon"
)

const (
	albionPort = 5056
	// Windows coalesces packets before Npcap sees them, so this needs to be
	// much larger than one packet (see albiondata-client).
	snapLen            = 262144
	trafficReportEvery = 30 * time.Second
)

type adapter struct {
	name   string
	handle *pcap.Handle
}

type eventHandler func(device string, params map[byte]interface{})
type responseHandler func(device string, opCode byte, params map[byte]interface{})

func main() {
	probe := flag.Bool("probe", false, "write every game event to capture-test.jsonl")
	flag.Parse()
	adapters, err := openAdapters()
	if *probe {
		if err != nil {
			fail(err.Error())
		}
		runProbe(adapters)
		return
	}
	l := newLedger(os.Stdout)
	if err != nil {
		l.emit(map[string]interface{}{"type": "error", "message": err.Error()})
		os.Exit(1)
	}
	for _, a := range adapters {
		go listen(a, l.onEvent, l.onResponse)
	}
	l.emit(map[string]interface{}{"type": "ready", "adapters": len(adapters)})
	go func() {
		for range time.Tick(trafficReportEvery) {
			l.reportTraffic()
		}
	}()
	// the app closes stdin when it stops logging
	io.Copy(io.Discard, bufio.NewReader(os.Stdin))
}

func openAdapters() ([]adapter, error) {
	devices, err := pcap.FindAllDevs()
	if err != nil {
		return nil, fmt.Errorf("could not list network adapters; is Npcap installed? (%v)", err)
	}
	var adapters []adapter
	for _, device := range devices {
		handle, err := pcap.OpenLive(device.Name, snapLen, false, pcap.BlockForever)
		if err != nil {
			continue
		}
		if err := handle.SetBPFFilter(fmt.Sprintf("udp port %d", albionPort)); err != nil {
			handle.Close()
			continue
		}
		adapters = append(adapters, adapter{device.Name, handle})
	}
	if len(adapters) == 0 {
		return nil, fmt.Errorf("could not open any network adapter for capture; try running Loot Ledger as administrator")
	}
	return adapters, nil
}

// one parser per adapter, since fragments are reassembled per stream
func listen(a adapter, onEvent eventHandler, onResponse responseHandler) {
	parser := photon.NewPhotonParser(
		func(byte, map[byte]interface{}) {},
		func(opCode byte, _ int16, _ string, params map[byte]interface{}) { onResponse(a.name, opCode, params) },
		func(_ byte, params map[byte]interface{}) { onEvent(a.name, params) },
	)
	for packet := range gopacket.NewPacketSource(a.handle, a.handle.LinkType()).Packets() {
		if udp, ok := packet.Layer(layers.LayerTypeUDP).(*layers.UDP); ok && len(udp.Payload) > 0 {
			parser.ReceivePacket(udp.Payload)
		}
	}
}

func fail(message string) {
	fmt.Println(message)
	fmt.Println("Press Enter to close.")
	fmt.Scanln()
	os.Exit(1)
}
