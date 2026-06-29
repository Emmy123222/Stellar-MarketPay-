WASM_TARGET = wasm32-unknown-unknown
WASM_OUT    = target/$(WASM_TARGET)/release/marketpay_contract.wasm
WASM_OPT    = $(WASM_OUT:.wasm=.optimized.wasm)

.PHONY: build build-optimized test clean check-wasm-opt

# Standard release build (Cargo already applies opt-level=z, lto, codegen-units=1)
build:
	cargo build --target $(WASM_TARGET) --release

# Optimized build: cargo release + wasm-opt -Oz post-processing
# Requires wasm-opt (install via: cargo install wasm-opt  OR  brew install binaryen)
build-optimized: build check-wasm-opt
	wasm-opt -Oz --strip-debug --strip-producers \
		-o $(WASM_OPT) \
		$(WASM_OUT)
	@echo ""
	@echo "=== Binary size comparison ==="
	@wc -c < $(WASM_OUT)  | xargs printf "  Before wasm-opt : %d bytes\n"
	@wc -c < $(WASM_OPT)  | xargs printf "  After  wasm-opt : %d bytes\n"
	@echo ""
	@echo "Optimized binary: $(WASM_OPT)"

# Run all tests
test:
	cargo test

# Verify wasm-opt is available before attempting the optimized build
check-wasm-opt:
	@command -v wasm-opt >/dev/null 2>&1 || { \
		echo "wasm-opt not found. Install it with:"; \
		echo "  cargo install wasm-opt"; \
		echo "  OR: brew install binaryen (macOS)"; \
		echo "  OR: apt install binaryen (Debian/Ubuntu)"; \
		exit 1; \
	}

clean:
	cargo clean
