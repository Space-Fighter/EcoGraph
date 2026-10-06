#ifndef WASTE_CLASSIFIER_HPP
#define WASTE_CLASSIFIER_HPP

#include <string>

struct ClassificationResult {
    std::string binType;  // recyclable | compost | general | medical | chemical
    bool hazardous;
};

// Rule-based: lowercases the description and looks for category keywords. Hazardous
// categories (medical, chemical) are checked first, so "plastic syringe" is medical.
ClassificationResult classifyWaste(const std::string& description);

#endif
