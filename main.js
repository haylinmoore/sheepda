let preludeContent = "";

// Fetch the prelude content on page load
fetch('./prelude.shp')
  .then(response => {
    if (!response.ok) {
      throw new Error('Failed to load prelude.shp');
    }
    return response.text();
  })
  .then(content => {
    preludeContent = content;
    document.getElementById("field-stdlib").value = preludeContent;

    // Load from hash after prelude is loaded to ensure everything is ready
    loadFromHash();
  })
  .catch(error => {
    console.error('Error loading prelude:', error);
    document.getElementById("field-stdlib").value = "Error loading prelude file";
  });

function run() {
  const runButton = document.getElementById("field-run");
  runButton.disabled = true;
  runButton.textContent = "Running...";

  setTimeout(function() {
    const code = document.getElementById("field-code").value;
    const stdlibChecked = document.getElementById("field-stdlib-checkbox").checked;
    const outputType = document.getElementById("field-output-type").value;

    const codeToRun = stdlibChecked ? preludeContent + code : code;

    try {
      const rv = sheepda.eval(codeToRun, outputType);
      if (rv[1] != "") {
        document.getElementById("field-output").value = "Error: " + rv[1].trim();
      } else {
        document.getElementById("field-output").value = rv[0].trim();
      }
    } catch(err) {
      document.getElementById("field-output").value = "Error: " + err.toString().trim();
    }

    runButton.textContent = "Run";
    runButton.disabled = false;
  }, 100);
}

function saveToHash() {
  const stdlibChecked = document.getElementById("field-stdlib-checkbox").checked;
  const outputType = document.getElementById("field-output-type").value;
  const code = document.getElementById("field-code").value;

  const stateObject = {
    stdlib: stdlibChecked,
    output: outputType,
    code: code
  };

  // Create hash and update URL without reloading the page
  const hashValue = btoa(encodeURIComponent(JSON.stringify(stateObject)));
  window.history.replaceState(null, "", "#" + hashValue);
}

function loadFromHash() {
  if (location.hash && location.hash !== "#") {
    try {
      const hashValue = location.hash.slice(1); // Remove the # symbol
      const stateObject = JSON.parse(decodeURIComponent(atob(hashValue)));

      // Apply the loaded state to the UI
      document.getElementById("field-stdlib-checkbox").checked = stateObject.stdlib;
      document.getElementById("field-output-type").value = stateObject.output;
      document.getElementById("field-code").value = stateObject.code;
    } catch (error) {
      console.error("Error parsing hash:", error);
      // Fall back to default code if hash parsing fails
      loadDefaultCode();
    }
  } else {
    // No hash, load default code
    loadDefaultCode();
  }
}

function loadDefaultCode() {
  document.getElementById("field-code").value = [
    "# define the messages",
    "fizzmsg = (cons (num 0 7 0) (cons (num 1 0 5) (cons (num 1 2 2) (cons (num 1 2 2) nil))))",
    "buzzmsg = (cons (num 0 6 6) (cons (num 1 1 7) (cons (num 1 2 2) (cons (num 1 2 2) nil))))",
    "fizzbuzzmsg = (cons (num 0 7 0) (cons (num 1 0 5) (cons (num 1 2 2) (cons (num 1 2 2)",
    "    (cons (num 0 9 8) (cons (num 1 1 7) (cons (num 1 2 2) (cons (num 1 2 2) nil))))))))",
    "",
    "# fizzbuzz",
    "fizzbuzz = λn.",
    "  (for n λi.",
    "    (do2",
    "      (if (zero? (% i 3))",
    "          λ_. (if (zero? (% i 5))",
    "                  λ_. (print-list fizzbuzzmsg)",
    "                  λ_. (print-list fizzmsg))",
    "          λ_. (if (zero? (% i 5))",
    "                  λ_. (print-list buzzmsg)",
    "                  λ_. (print-list (itoa i))))",
    "      (print-newline nil)))",
    "",
    "# run fizzbuzz 20 times",
    "(fizzbuzz (num 0 2 0))"].join("\n");
}

// Initialize when DOM is fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Set up hash change listener
  window.addEventListener('hashchange', loadFromHash);

  // Add event listeners for buttons
  document.getElementById("field-run").addEventListener("click", function(e) {
    e.preventDefault();
    run();
  });

  document.getElementById("field-share").addEventListener("click", function(e) {
    e.preventDefault();
    saveToHash();
  });
});
