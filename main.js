let preludeContent = "";
let defaultContent = "";

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

    // After prelude is loaded, check hash and load default if needed
    if (location.hash && location.hash !== "#") {
      loadFromHash();
    } else {
      // Only fetch default.shp if we need it
      loadDefaultCode();
    }
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
  // Only fetch default.shp if we haven't already
  if (!defaultContent) {
    const codeEditor = document.getElementById("field-code");
    codeEditor.value = "Loading default example...";

    fetch('./default.shp')
      .then(response => {
        if (!response.ok) {
          throw new Error('Failed to load default.shp');
        }
        return response.text();
      })
      .then(content => {
        defaultContent = content;
        codeEditor.value = defaultContent;
      })
      .catch(error => {
        console.error('Error loading default code:', error);
        codeEditor.value = "Error loading default example";
      });
  } else {
    // Use cached default content if we already fetched it
    document.getElementById("field-code").value = defaultContent;
  }
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
