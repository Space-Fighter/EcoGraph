#include "waste_classifier.hpp"

#include <algorithm>
#include <cctype>
#include <vector>

namespace {

struct Rule {
    const char* binType;
    bool hazardous;
    std::vector<std::string> keywords;
};

// Order matters: first matching rule wins, hazardous rules come first.
const std::vector<Rule>& rules() {
    static const std::vector<Rule> table = {
        {"medical", true, {"syringe", "bandage", "needle", "blood", "gauze", "medical", "surgical"}},
        {"chemical", true, {"solvent", "acid", "battery", "paint", "pesticide", "chemical", "bleach"}},
        {"recyclable", false, {"plastic", "bottle", "can", "glass", "paper", "cardboard", "newspaper"}},
        {"compost", false, {"food", "organic", "vegetable", "fruit", "leaves", "peel", "garden"}},
    };
    return table;
}

}  // namespace

ClassificationResult classifyWaste(const std::string& description) {
    std::string text = description;
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    const std::vector<Rule>& table = rules();
    for (size_t i = 0; i < table.size(); ++i) {
        for (size_t k = 0; k < table[i].keywords.size(); ++k) {
            if (text.find(table[i].keywords[k]) != std::string::npos) {
                return ClassificationResult{table[i].binType, table[i].hazardous};
            }
        }
    }
    return ClassificationResult{"general", false};
}
